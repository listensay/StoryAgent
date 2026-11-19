import { lazy, Suspense, useEffect, useState } from 'react';
import { AppShell, Box, Divider, Group, Loader, NavLink, ScrollArea, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { BookOpen, Download, Feather, FileText, Library, List, Network, NotebookPen, Puzzle, Settings2, Sparkles, TrendingUp, X, type AppIcon } from './icons';
import { useWorkspace } from './useWorkspace';
import { Button, IconButton, ModalPresence, Modal, Select } from './components';
import { exportNovel, parseWorkspace } from './domain';
import { exportFile, pickFiles } from './platform';
import { Projects } from './pages/Projects';
import './App.css';

const Writing = lazy(() => import('./pages/Writing').then(m => ({ default: m.Writing })));
const Knowledge = lazy(() => import('./pages/Knowledge').then(m => ({ default: m.Knowledge })));
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const Research = lazy(() => import('./pages/Research').then(m => ({ default: m.Research })));
const Skills = lazy(() => import('./pages/Skills').then(m => ({ default: m.Skills })));
const Styles = lazy(() => import('./pages/Styles').then(m => ({ default: m.Styles })));

type Route = 'projects' | 'write' | 'details' | 'outline' | 'memory' | 'research' | 'skills' | 'styles' | 'settings';
const names: Record<Route, string> = { projects: '我的小说', write: '写作', details: '创作准备', outline: '故事规划', memory: '小说记忆', research: '资料研究', skills: '小说 Skill', styles: '写作风格', settings: 'AI 与设置' };
function App() {
  const store = useWorkspace();
  const [route, setRoute] = useState<Route>('projects');
  const [researchTask, setResearchTask] = useState<'scan' | 'style'>('scan');
  const [navOpened, setNavOpened] = useState(false);
  const [exporting, setExporting] = useState(false), [format, setFormat] = useState<'txt' | 'md'>('txt');
  const project = store.state.projects.find(p => p.id === store.state.activeProjectId);
  const projectRoute = ['write', 'details', 'outline', 'memory'].includes(route);
  const navigate = (next: Route) => { if (next === 'research') setResearchTask('scan'); setRoute(next); setNavOpened(false); };
  const open = (id: string) => { store.update(s => { s.activeProjectId = id; }); navigate('write'); };
  const restore = async () => { try { const files = await pickFiles(); if (files[0]) await store.replace(parseWorkspace(new TextDecoder().decode(files[0].bytes))); } catch (e) { store.notify(String(e)); } };
  useEffect(() => {
    if (store.message) notifications.show({ id: 'workspace-message', message: store.message, autoClose: 6000, withCloseButton: true, onClose: () => store.notify(''), closeButtonProps: { icon: <X size={18} />, 'aria-label': '关闭通知' } });
  }, [store.message, store.notify]);
  const nav = (id: Route, Icon: AppIcon) => <NavLink component="button" key={id} label={names[id]} leftSection={<Icon size={21} />} active={route === id} onClick={() => navigate(id)} aria-current={route === id ? 'page' : undefined} />;
  if (store.loadError) return <Stack className="load-screen" align="center" justify="center"><Feather size={32} /><Title order={1}>数据加载失败</Title><Text c="red.8">{store.loadError}</Text><Button onClick={() => location.reload()}>重试</Button><Button onClick={() => void restore()}>从备份恢复</Button></Stack>;
  if (!store.loaded) return <Stack className="load-screen" align="center" justify="center"><Loader color="story" /><Text>加载中…</Text></Stack>;
  return <AppShell navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !navOpened } }} padding={0}>
    <AppShell.Navbar p="sm">
      <Group justify="space-between" mb="lg" px="xs" pt="sm">
        <UnstyledButton onClick={() => navigate('projects')} aria-label="StoryAgent 首页"><Group gap="xs" wrap="nowrap"><Feather size={26} color="#c64700" /><Text fw={600} size="lg">StoryAgent</Text></Group></UnstyledButton>
        <Box hiddenFrom="sm"><IconButton icon={X} label="关闭导航" onClick={() => setNavOpened(false)} /></Box>
      </Group>
      <AppShell.Section grow component={ScrollArea}>
        <Stack gap={4}>{nav('projects', Library)}{project && <><Divider my="sm" /><Text size="xs" c="dimmed" px="sm" truncate title={project.title}>{project.title}</Text>{nav('write', NotebookPen)}{nav('details', Network)}{nav('outline', FileText)}{nav('memory', BookOpen)}</>}<Divider my="sm" />{nav('research', TrendingUp)}{nav('styles', Sparkles)}{nav('skills', Puzzle)}</Stack>
      </AppShell.Section>
      <AppShell.Section pt="lg">{nav('settings', Settings2)}<Text size="xs" c="dimmed" ta="center" pt="md">StoryAgent 0.1</Text></AppShell.Section>
    </AppShell.Navbar>
    <AppShell.Main className="main-shell">
      <Group component="header" justify="flex-end" wrap="nowrap" hiddenFrom={projectRoute && project ? undefined : 'sm'} className="app-header">
        <Box hiddenFrom="sm" mr="auto"><IconButton icon={List} label="打开导航" onClick={() => setNavOpened(true)} /></Box>
        {projectRoute && project && <Button icon={Download} onClick={() => setExporting(true)}>导出</Button>}
      </Group>
      <Box className="main-content"><Suspense fallback={<Stack align="center" justify="center" mih={300}><Loader /></Stack>}>
        {route === 'projects' && <Projects store={store} onOpen={open} />}
        {projectRoute && !project && <Projects store={store} onOpen={open} />}
        {route === 'write' && project && <Writing key={project.id} project={project} store={store} onSettings={() => navigate('settings')} />}
        {['details', 'outline', 'memory'].includes(route) && project && <Knowledge key={project.id + route} project={project} store={store} mode={route as 'details' | 'outline' | 'memory'} />}
        {route === 'research' && <Research store={store} initialTask={researchTask} />}
        {route === 'skills' && <Skills store={store} />}
        {route === 'styles' && <Styles store={store} onResearch={() => { navigate('research'); setResearchTask('style'); }} />}
        {route === 'settings' && <Settings store={store} />}
      </Suspense></Box>
    </AppShell.Main>
    <ModalPresence>{exporting && project && <Modal title="导出小说" onClose={() => setExporting(false)} footer={<><Button onClick={() => setExporting(false)}>取消</Button><Button primary onClick={() => void exportFile(project.title.replace(/[\/:*?"<>|]/g, '_') + '.' + format, exportNovel(project, format)).then(saved => { if (saved) { store.notify('已导出'); setExporting(false); } }).catch(e => store.notify(String(e)))}>导出</Button></>}><Select label="文件格式" value={format} onChange={v => setFormat(v as 'txt' | 'md')} options={[{ value: 'txt', label: 'TXT' }, { value: 'md', label: 'Markdown' }]} /></Modal>}</ModalPresence>
  </AppShell>;
}
export default App;
