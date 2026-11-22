use hyper_util::client::proxy::matcher::Matcher;
use reqwest::{ClientBuilder, Proxy, Url};
use serde::{Deserialize, Serialize};
use std::{
    net::IpAddr,
    sync::{OnceLock, RwLock},
};

#[derive(Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum ProxyMode {
    #[default]
    System,
    Manual,
    Direct,
}

#[derive(Clone, Default, Deserialize, Serialize, PartialEq, Eq, Debug)]
#[serde(default, rename_all = "camelCase")]
pub struct ProxySettings {
    pub mode: ProxyMode,
    pub url: String,
}

impl ProxySettings {
    pub fn normalized(mut self) -> Result<Self, String> {
        self.url = self.url.trim().to_string();
        if self.url.is_empty() {
            if self.mode == ProxyMode::Manual {
                return Err("请输入代理地址".into());
            }
            return Ok(self);
        }
        let url = parse_proxy(&self.url).ok_or("代理地址无效")?;
        if !url.username().is_empty() || url.password().is_some() {
            return Err("代理地址不能包含用户名或密码".into());
        }
        self.url = url.as_str().trim_end_matches('/').to_string();
        Ok(self)
    }

    pub fn from_workspace(data: &serde_json::Value) -> Result<Self, String> {
        data.get("proxy")
            .map(|value| serde_json::from_value::<Self>(value.clone()))
            .transpose()
            .map_err(|_| "代理设置无效")?
            .unwrap_or_default()
            .normalized()
    }
}

static SETTINGS: OnceLock<RwLock<ProxySettings>> = OnceLock::new();
fn settings() -> &'static RwLock<ProxySettings> {
    SETTINGS.get_or_init(|| RwLock::new(ProxySettings::default()))
}
pub fn apply_settings(value: ProxySettings) {
    *settings()
        .write()
        .unwrap_or_else(|error| error.into_inner()) = value;
}

#[tauri::command]
pub fn validate_proxy_settings(settings: ProxySettings) -> Result<ProxySettings, String> {
    settings.normalized()
}

fn parse_proxy(value: &str) -> Option<Url> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    let url = Url::parse(&if value.contains("://") {
        value.to_string()
    } else {
        format!("http://{value}")
    })
    .ok()?;
    if !["http", "https", "socks4", "socks4a", "socks5", "socks5h"].contains(&url.scheme())
        || url.host_str().is_none()
        || url.port_or_known_default().unwrap_or(0) == 0
        || !["", "/"].contains(&url.path())
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    Some(url)
}

pub(crate) fn is_loopback(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.trim_end_matches('.');
    if host.eq_ignore_ascii_case("localhost") || host.to_ascii_lowercase().ends_with(".localhost") {
        return true;
    }
    match host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .parse::<IpAddr>()
    {
        Ok(IpAddr::V4(address)) => address.is_loopback(),
        Ok(IpAddr::V6(address)) => {
            address.is_loopback()
                || address
                    .to_ipv4_mapped()
                    .is_some_and(|address| address.is_loopback())
        }
        Err(_) => false,
    }
}

#[derive(Clone, Default)]
struct ProxyPolicy {
    http: Option<Url>,
    https: Option<Url>,
    bypass: String,
    exclude_simple_hosts: bool,
}
impl ProxyPolicy {
    fn for_url(&self, url: &Url) -> Option<Url> {
        // GUI launches may lack NO_PROXY. Apply this to every destination, including redirects.
        if is_loopback(url)
            || (self.exclude_simple_hosts
                && url
                    .host_str()
                    .is_some_and(|host| !host.contains('.') && !host.contains(':')))
        {
            return None;
        }
        match url.scheme() {
            "http" => self.http.clone(),
            "https" => self.https.clone(),
            _ => None,
        }
    }
    fn from_settings(value: &ProxySettings) -> Self {
        match value.mode {
            ProxyMode::System => system_policy(),
            ProxyMode::Direct => Self::default(),
            ProxyMode::Manual => {
                let url = parse_proxy(&value.url);
                Self {
                    http: url.clone(),
                    https: url,
                    ..Self::default()
                }
            }
        }
    }
    fn route(self) -> impl Fn(&Url) -> Option<Url> + Send + Sync {
        // reqwest 0.12's custom proxy does not apply its NoProxy list.
        let matcher = Matcher::builder()
            .http(self.http.as_ref().map(Url::as_str).unwrap_or(""))
            .https(self.https.as_ref().map(Url::as_str).unwrap_or(""))
            .no(&self.bypass)
            .build();
        move |url| {
            let proxy = self.for_url(url)?;
            let destination = url.as_str().parse().ok()?;
            matcher.intercept(&destination)?;
            Some(proxy)
        }
    }
    fn configure(self, builder: ClientBuilder) -> ClientBuilder {
        builder.no_proxy().proxy(Proxy::custom(self.route()))
    }
    fn configure_updater(
        self,
        builder: reqwest_updater::ClientBuilder,
    ) -> reqwest_updater::ClientBuilder {
        builder
            .no_proxy()
            .proxy(reqwest_updater::Proxy::custom(self.route()))
    }
}

fn current_policy() -> ProxyPolicy {
    let value = settings()
        .read()
        .unwrap_or_else(|error| error.into_inner())
        .clone();
    ProxyPolicy::from_settings(&value)
}
pub fn client_builder() -> ClientBuilder {
    current_policy().configure(reqwest::Client::builder())
}

// The updater uses reqwest 0.13; resolve the same policy when checking and downloading.
pub fn configure_updater(
    builder: reqwest_updater::ClientBuilder,
) -> reqwest_updater::ClientBuilder {
    current_policy().configure_updater(builder)
}

#[derive(Serialize)]
pub struct ProxyDetection {
    http: Option<String>,
    https: Option<String>,
}
fn display_url(url: &Url) -> String {
    let mut url = url.clone();
    let _ = url.set_username("");
    let _ = url.set_password(None);
    url.as_str().trim_end_matches('/').to_string()
}
#[tauri::command]
pub fn detect_proxy() -> ProxyDetection {
    let policy = system_policy();
    ProxyDetection {
        http: policy.http.as_ref().map(display_url),
        https: policy.https.as_ref().map(display_url),
    }
}

fn environment_policy(
    mut system: ProxyPolicy,
    read: impl Fn(&str) -> Option<String>,
) -> ProxyPolicy {
    let get = |upper, lower| {
        read(upper)
            .or_else(|| read(lower))
            .filter(|value| !value.trim().is_empty())
    };
    let all = get("ALL_PROXY", "all_proxy").and_then(|value| parse_proxy(&value));
    system.http = get("HTTP_PROXY", "http_proxy")
        .and_then(|value| parse_proxy(&value))
        .or_else(|| all.clone())
        .or(system.http);
    system.https = get("HTTPS_PROXY", "https_proxy")
        .and_then(|value| parse_proxy(&value))
        .or(all)
        .or(system.https);
    if let Some(bypass) = get("NO_PROXY", "no_proxy") {
        if !system.bypass.is_empty() {
            system.bypass.push(',');
        }
        system.bypass.push_str(&bypass);
    }
    system
}
fn system_policy() -> ProxyPolicy {
    environment_policy(native_policy(), |name| std::env::var(name).ok())
}

#[cfg(target_os = "macos")]
fn native_policy() -> ProxyPolicy {
    use system_configuration::{
        core_foundation::{
            array::CFArray,
            base::{CFType, TCFType},
            number::CFNumber,
            string::CFString,
        },
        dynamic_store::SCDynamicStoreBuilder,
    };
    let Some(store) = SCDynamicStoreBuilder::new("StoryAgent").build() else {
        return ProxyPolicy::default();
    };
    let Some(proxies) = store.get_proxies() else {
        return ProxyPolicy::default();
    };
    let number = |key: &str| {
        proxies
            .find(&CFString::new(key))
            .and_then(|value| value.downcast::<CFNumber>())
            .and_then(|value| value.to_i32())
    };
    let text = |key: &str| {
        proxies
            .find(&CFString::new(key))
            .and_then(|value| value.downcast::<CFString>())
            .map(|value| value.to_string())
    };
    let address = |prefix: &str, scheme: &str| {
        if number(&format!("{prefix}Enable")) != Some(1) {
            return None;
        }
        let host = text(&format!("{prefix}Proxy"))?;
        let port = number(&format!("{prefix}Port"))?;
        if !(1..=65535).contains(&port) {
            return None;
        }
        let host = if host.contains(':') && !host.starts_with('[') {
            format!("[{host}]")
        } else {
            host
        };
        parse_proxy(&format!("{scheme}://{host}:{port}"))
    };
    let socks = address("SOCKS", "socks5h");
    let bypass = proxies
        .find(&CFString::new("ExceptionsList"))
        .and_then(|value| value.downcast::<CFArray>())
        .map(|values| {
            values
                .iter()
                .filter_map(|value| {
                    unsafe { CFType::wrap_under_get_rule(*value) }.downcast::<CFString>()
                })
                .map(|value| normalize_bypass(&value.to_string()))
                .collect::<Vec<_>>()
                .join(",")
        })
        .unwrap_or_default();
    ProxyPolicy {
        http: address("HTTP", "http").or_else(|| socks.clone()),
        https: address("HTTPS", "http").or(socks),
        bypass,
        exclude_simple_hosts: number("ExcludeSimpleHostnames") == Some(1),
    }
}

#[cfg(windows)]
fn native_policy() -> ProxyPolicy {
    let Ok(registry) = windows_registry::CURRENT_USER
        .open("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings")
    else {
        return ProxyPolicy::default();
    };
    if registry.get_u32("ProxyEnable").unwrap_or(0) != 1 {
        return ProxyPolicy::default();
    }
    windows_policy(
        &registry.get_string("ProxyServer").unwrap_or_default(),
        &registry.get_string("ProxyOverride").unwrap_or_default(),
    )
}
#[cfg(not(any(target_os = "macos", windows)))]
fn native_policy() -> ProxyPolicy {
    ProxyPolicy::default()
}

#[cfg(any(windows, test))]
fn windows_policy(server: &str, overrides: &str) -> ProxyPolicy {
    let mut policy = ProxyPolicy::default();
    if !server.contains('=') {
        policy.http = parse_proxy(server);
        policy.https = policy.http.clone();
    } else {
        let mut socks = None;
        for entry in server.split(';') {
            let Some((protocol, address)) = entry.trim().split_once('=') else {
                continue;
            };
            match protocol.trim().to_ascii_lowercase().as_str() {
                "http" => policy.http = parse_proxy(address),
                "https" => policy.https = parse_proxy(address),
                "socks" => socks = parse_proxy(&format!("socks5h://{}", address.trim())),
                _ => {}
            }
        }
        policy.http = policy.http.or_else(|| socks.clone());
        policy.https = policy.https.or(socks);
    }
    policy.exclude_simple_hosts = overrides
        .split(';')
        .any(|value| value.trim().eq_ignore_ascii_case("<local>"));
    policy.bypass = overrides
        .split(';')
        .filter(|value| !value.trim().eq_ignore_ascii_case("<local>"))
        .map(normalize_bypass)
        .collect::<Vec<_>>()
        .join(",");
    policy
}

#[cfg(any(target_os = "macos", windows, test))]
fn normalize_bypass(value: &str) -> String {
    let value = value.trim();
    let parts = value.split('.').collect::<Vec<_>>();
    if parts.len() == 4 {
        if let Some(wildcard) = parts.iter().position(|part| *part == "*") {
            if wildcard > 0 && parts[wildcard..].iter().all(|part| *part == "*") {
                let mut octets = [0u8; 4];
                if parts[..wildcard].iter().enumerate().all(|(index, part)| {
                    part.parse()
                        .map(|value| {
                            octets[index] = value;
                        })
                        .is_ok()
                }) {
                    return format!(
                        "{}.{}.{}.{}/{}",
                        octets[0],
                        octets[1],
                        octets[2],
                        octets[3],
                        wildcard * 8
                    );
                }
            }
        }
    }
    value.strip_prefix("*.").unwrap_or(value).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
        time::Duration,
    };

    #[test]
    fn validates_manual_settings_without_persisting_credentials() {
        let manual = |url: &str| {
            ProxySettings {
                mode: ProxyMode::Manual,
                url: url.into(),
            }
            .normalized()
        };
        assert_eq!(
            manual(" 127.0.0.1:7890 ").unwrap().url,
            "http://127.0.0.1:7890"
        );
        for url in [
            "http://proxy.test",
            "https://proxy.test:8443",
            "socks5h://[::1]:1080",
            "socks5://127.0.0.1:1080",
        ] {
            assert!(manual(url).is_ok(), "{url}");
        }
        for url in [
            "",
            "file:///tmp/proxy",
            "http://proxy.test:0",
            "http://proxy.test/path",
            "http://proxy.test/?password=value",
            "http://proxy.test/#secret",
        ] {
            assert!(manual(url).is_err(), "{url}");
        }
        assert_eq!(
            manual("http://user:secret@proxy.test:7890").unwrap_err(),
            "代理地址不能包含用户名或密码"
        );
        assert_eq!(
            ProxySettings::from_workspace(&serde_json::json!({})).unwrap(),
            ProxySettings::default()
        );
        let value = manual("127.0.0.1:7890").unwrap();
        assert_eq!(
            ProxySettings::from_workspace(&serde_json::json!({ "proxy": value })).unwrap(),
            value
        );
        assert!(
            ProxySettings::from_workspace(&serde_json::json!({ "proxy": { "mode": "unknown" } }))
                .is_err()
        );
    }

    #[test]
    fn bypasses_only_loopback_addresses_in_every_mode() {
        let policy = ProxyPolicy {
            http: parse_proxy("http://proxy.test:7890"),
            https: parse_proxy("http://proxy.test:7890"),
            ..ProxyPolicy::default()
        };
        for address in [
            "localhost",
            "LOCALHOST.",
            "gateway.localhost",
            "127.0.0.1",
            "127.2.3.4",
            "[::1]",
            "[::ffff:127.0.0.1]",
        ] {
            for scheme in ["http", "https"] {
                assert!(
                    policy
                        .for_url(&Url::parse(&format!("{scheme}://{address}:3425/v1")).unwrap())
                        .is_none(),
                    "{address}"
                );
            }
        }
        for address in [
            "localhost.example.com",
            "notlocalhost",
            "128.0.0.1",
            "[2001:db8::1]",
            "api.example.com",
        ] {
            assert!(
                policy
                    .for_url(&Url::parse(&format!("https://{address}/v1")).unwrap())
                    .is_some(),
                "{address}"
            );
        }
        let direct = ProxyPolicy::from_settings(&ProxySettings {
            mode: ProxyMode::Direct,
            url: "http://proxy.test:7890".into(),
        });
        assert!(
            direct
                .for_url(&Url::parse("https://api.example.com").unwrap())
                .is_none()
        );
    }

    #[test]
    fn environment_precedence_and_system_exclusions() {
        let system = ProxyPolicy {
            http: parse_proxy("127.0.0.1:7890"),
            https: parse_proxy("127.0.0.1:7890"),
            bypass: "*.local,192.168.0.0/16".into(),
            ..ProxyPolicy::default()
        };
        let variables = std::collections::HashMap::from([
            ("ALL_PROXY", "socks5h://127.0.0.1:1080"),
            ("https_proxy", "http://127.0.0.1:8080"),
            ("NO_PROXY", "example.test"),
        ]);
        let policy = environment_policy(system, |name| {
            variables.get(name).map(|value| value.to_string())
        });
        assert_eq!(policy.http.unwrap().as_str(), "socks5h://127.0.0.1:1080");
        assert_eq!(policy.https.unwrap().port(), Some(8080));
        assert_eq!(policy.bypass, "*.local,192.168.0.0/16,example.test");
        assert_eq!(
            display_url(&parse_proxy("http://user:secret@proxy.test:7890").unwrap()),
            "http://proxy.test:7890"
        );
    }

    #[test]
    fn windows_protocols_and_wildcard_bypass() {
        let policy = windows_policy(
            "http=127.0.0.1:7890;https=127.0.0.1:7891",
            "<local>;127.*.*.*;192.168.*.*;*.example.com",
        );
        assert_eq!(policy.http.unwrap().port(), Some(7890));
        assert_eq!(policy.https.unwrap().port(), Some(7891));
        assert!(policy.exclude_simple_hosts);
        assert_eq!(policy.bypass, "127.0.0.0/8,192.168.0.0/16,example.com");
        let policy = windows_policy("socks=127.0.0.1:1080", "");
        assert_eq!(policy.https.unwrap().scheme(), "socks5h");
    }

    fn server(code: u16, request_start: String) -> (Url, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = Url::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap();
        let handle = thread::spawn(move || {
            let start = std::time::Instant::now();
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(error)
                        if error.kind() == std::io::ErrorKind::WouldBlock
                            && start.elapsed() < Duration::from_secs(5) =>
                    {
                        thread::sleep(Duration::from_millis(10))
                    }
                    Err(error) => panic!("fixture did not receive request: {error}"),
                }
            };
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = [0; 4096];
            let count = stream.read(&mut bytes).unwrap();
            assert!(String::from_utf8_lossy(&bytes[..count]).starts_with(&request_start));
            write!(
                stream,
                "HTTP/1.1 {code} Status\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"
            )
            .unwrap();
        });
        (url, handle)
    }

    #[tokio::test]
    async fn local_gateway_stays_direct_while_external_requests_use_the_proxy() {
        let (gateway, gateway_server) = server(200, "GET /v1/models ".into());
        let (proxy, proxy_server) = server(502, "GET http://api.example.test/v1/models ".into());
        let policy = ProxyPolicy {
            http: Some(proxy),
            ..ProxyPolicy::default()
        };
        let client = policy
            .configure(reqwest::Client::builder())
            .timeout(Duration::from_secs(3))
            .build()
            .unwrap();
        assert_eq!(
            client
                .get(gateway.join("v1/models").unwrap())
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
        assert_eq!(
            client
                .get("http://api.example.test/v1/models")
                .send()
                .await
                .unwrap()
                .status(),
            502
        );
        gateway_server.join().unwrap();
        proxy_server.join().unwrap();
    }

    #[tokio::test]
    async fn automatic_exclusions_are_applied_to_external_hostnames() {
        let (gateway, gateway_server) = server(200, "GET / ".into());
        let policy = ProxyPolicy {
            http: parse_proxy("http://127.0.0.1:1"),
            bypass: "example.test".into(),
            ..ProxyPolicy::default()
        };
        let socket =
            std::net::SocketAddr::new("127.0.0.1".parse().unwrap(), gateway.port().unwrap());
        let client = policy
            .configure(reqwest::Client::builder().resolve("example.test", socket))
            .timeout(Duration::from_secs(3))
            .build()
            .unwrap();
        assert_eq!(
            client
                .get(format!("http://example.test:{}/", socket.port()))
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
        gateway_server.join().unwrap();
    }

    #[tokio::test]
    async fn direct_mode_clears_existing_proxies() {
        let (gateway, gateway_server) = server(200, "GET / ".into());
        let socket =
            std::net::SocketAddr::new("127.0.0.1".parse().unwrap(), gateway.port().unwrap());
        let builder = reqwest::Client::builder()
            .proxy(Proxy::all("http://127.0.0.1:1").unwrap())
            .resolve("example.test", socket);
        let client = ProxyPolicy::default()
            .configure(builder)
            .timeout(Duration::from_secs(3))
            .build()
            .unwrap();
        assert_eq!(
            client
                .get(format!("http://example.test:{}/", socket.port()))
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
        gateway_server.join().unwrap();
    }

    #[tokio::test]
    async fn updater_applies_the_same_proxy_routing() {
        // The updater installs this provider before creating its reqwest client.
        let _ = rustls::crypto::ring::default_provider().install_default();
        let (gateway, gateway_server) = server(200, "GET /latest.json ".into());
        let (proxy, proxy_server) =
            server(502, "GET http://updates.example.test/latest.json ".into());
        let policy = ProxyPolicy {
            http: Some(proxy),
            ..ProxyPolicy::default()
        };
        let client = policy
            .configure_updater(reqwest_updater::Client::builder())
            .timeout(Duration::from_secs(3))
            .build()
            .unwrap();
        assert_eq!(
            client
                .get(gateway.join("latest.json").unwrap())
                .send()
                .await
                .unwrap()
                .status(),
            200
        );
        assert_eq!(
            client
                .get("http://updates.example.test/latest.json")
                .send()
                .await
                .unwrap()
                .status(),
            502
        );
        gateway_server.join().unwrap();
        proxy_server.join().unwrap();
    }
}
