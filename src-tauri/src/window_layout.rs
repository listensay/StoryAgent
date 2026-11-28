use tauri::WebviewWindow;

// The configuration keeps this window hidden until its initial geometry is ready.
// Keep coordinates in the monitor's units (physical pixels, including negative origins).
pub fn prepare(window: &WebviewWindow) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    {
        unsafe extern "C" { fn storyagent_fit_mac_window(window: *mut std::ffi::c_void); }
        // AppKit's green fullscreen button needs the resizable style bit. The native
        // controller locks normal content dimensions, not the fullscreen transition.
        window.set_resizable(true)?;
        window.set_maximizable(true)?;
        // SAFETY: setup runs on the main thread; Tauri owns the live NSWindow.
        unsafe { storyagent_fit_mac_window(window.ns_window()?); }
    }
    #[cfg(not(target_os = "macos"))]
    {
        // A compositor may refuse maximize requests from a non-resizable window.
        // Request the maximized state before locking the frame, with a work-area-sized
        // normal frame as a fallback for window managers that discard that state.
        window.set_resizable(true)?;
        if let Some(monitor) = window.current_monitor()?.or(window.primary_monitor()?) {
            let area = monitor.work_area();
            let outer = window.outer_size()?;
            let inner = window.inner_size()?;
            let frame_width = outer.width.saturating_sub(inner.width);
            let frame_height = outer.height.saturating_sub(inner.height);
            window.set_position(area.position)?;
            window.set_size(tauri::PhysicalSize::new(
                area.size.width.saturating_sub(frame_width).max(1),
                area.size.height.saturating_sub(frame_height).max(1),
            ))?;
        }
        window.maximize()?;
        window.set_resizable(false)?;
    }
    window.show()?;
    // Wayland may decline focus activation; that is not a startup failure.
    let _ = window.set_focus();
    Ok(())
}
