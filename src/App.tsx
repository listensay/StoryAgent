import { lazy, Suspense, useEffect, useState } from 'react';
import { AppShell, Box, Center, Divider, Group, Loader, NavLink, ScrollArea, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { BookOpen, ChevronRight, Download, Feather, FileText, FolderOpen, Globe, Library, List, Network, NotebookPen, Puzzle, Settings2, Sparkles, TrendingUp, X, type AppIcon } from './icons';
import { useWorkspace } from './useWorkspace';
import { Button, IconButton, ModalPresence, Modal, Select } from './components';
import { exportNovel, parseWorkspace, type Job } from './domain';
import { exportFile, pickFiles } from './platform';
import { Projects } from './pages/Projects';
import './App.css';
import { TaskList } from './TaskList';
import { clearFinishedTasksFromList } from './taskQueue';
import { openWriting } from './jobWorkflow';
import { AppUpdateButton } from './AppUpdateButton';

const NovelAssistant = lazy(() => import('./NovelAssistantChat').then(m => ({ default: m.NovelAssistant })));
const Writing = lazy(() => import('./pages/Writing').then(m => ({ default: m.Writing })));
const Characters = lazy(() => import('./pages/Characters').then(m => ({ default: m.Characters })));
const Knowledge = lazy(() => import('./pages/Knowledge').then(m => ({ default: m.Knowledge })));
const Settings = lazy(() => import('./pages/Settings').then(m => ({ default: m.Settings })));
const Research = lazy(() => import('./pages/Research').then(m => ({ default: m.Research })));
const Skills = lazy(() => import('./pages/Skills').then(m => ({ default: m.Skills })));
const Training = lazy(() => import('./pages/Training').then(m => ({ default: m.Training })));
const NovelCreation = lazy(() => import('./pages/NovelCreation').then(m => ({ default: m.NovelCreation })));

type Route = 'projects' | 'create' | 'write' | 'details' | 'characters' | 'world' | 'outline' | 'memory' | 'research' | 'skills' | 'training' | 'settings';
const names: Record<Route, string> = { projects: '我的小说', create: '新建小说', write: '写作', details: '创作准备', characters: '人物档案', world: '世界设定', outline: '故事规划', memory: '小说记忆', research: '资料研究', skills: '技能管理', training: 'Skill 训练营', settings: 'AI 与设置' };
function App() {
  const store = useWorkspace();
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [route, setRoute] = useState<Route>('projects');
  const [appVersion, setAppVersion] = useState('');
  const [novelIdea, setNovelIdea] = useState('');
  const [novelGenre, setNovelGenre] = useState('');
  const [focusJob, setFocusJob] = useState<Job>();
  const [focusRequest, setFocusRequest] = useState(0);
  const [navOpened, setNavOpened] = useState(false);
  const [exporting, setExporting] = useState(false), [format, setFormat] = useState<'txt' | 'md'>('txt');
  const project = store.state.projects.find(p => p.id === store.state.activeProjectId);
  const projectRoute = ['write', 'details', 'characters', 'world', 'outline', 'memory'].includes(route);
  const navigate = (next: Route, projectId = store.stateRef.current.activeProjectId) => {
    if (next === 'write') { store.update(s => { openWriting(s, projectId); }); setFocusRequest(n => n + 1); }
    setFocusJob(undefined); setRoute(next); setNavOpened(false);
  };
  const open = (id: string) => { setAssistantOpen(false); navigate('write', id); };
  const openTask = (job: Job) => {
    if (job.projectId && store.state.projects.some(p => p.id === job.projectId)) store.update(s => { s.activeProjectId = job.projectId; });
    if (job.novelChat) { setRoute('outline'); setAssistantOpen(true); setNavOpened(false); return; }
    const next: Route = job.creationTask && store.state.creationDraft?.id === job.creationTask.draftId ? 'create' : job.creationTask ? job.creationTask.stage === 'outline' ? 'outline' : 'details' : job.training ? 'training' : ['scan', 'analyze', 'style', 'collect'].includes(job.kind) ? 'research' : job.kind === 'prepare' ? 'details' : job.kind === 'memory' ? 'memory' : job.kind === 'plan' && !job.steps.some(s => s.chapterId) ? 'outline' : 'write';
    setRoute(next); setFocusJob({ ...job }); setFocusRequest(n => n + 1); setNavOpened(false);
  };
  const restore = async () => { try { const files = await pickFiles(); if (files[0]) await store.replace(parseWorkspace(new TextDecoder().decode(files[0].bytes))); } catch (e) { store.notify(String(e)); } };
  useEffect(() => {
    if (store.message) notifications.show({ id: `workspace-message-${store.messageId}`, message: store.message, autoClose: 6000, withCloseButton: true, closeButtonProps: { icon: <X size={18} />, 'aria-label': '关闭通知' } });
  }, [store.message, store.messageId]);
  const nav = (id: Route, Icon: AppIcon) => <NavLink component="button" key={id} label={names[id]} leftSection={<Icon size={21} />} active={route === id} onClick={() => navigate(id)} aria-current={route === id ? 'page' : undefined} />;
  if (store.loadError) return <Stack className="load-screen" align="center" justify="center"><Feather size={32} /><Title order={1}>数据加载失败</Title><Text c="red.8">{store.loadError}</Text><Button onClick={() => location.reload()}>重试</Button><Button onClick={() => void restore()}>从备份恢复</Button></Stack>;
  if (!store.loaded) return <Stack className="load-screen" align="center" justify="center"><Loader color="story" /><Text>加载中…</Text></Stack>;
  return <AppShell navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !navOpened } }} padding={0}>
    <AppShell.Navbar p="sm">
      <Group justify="space-between" mb="lg" px="xs" pt="sm">
        <TaskList jobs={store.state.jobs} onOpen={openTask} onClearFinished={() => store.update(s => clearFinishedTasksFromList(s.jobs))} />
        <Box hiddenFrom="sm"><IconButton icon={X} label="关闭导航" onClick={() => setNavOpened(false)} /></Box>
      </Group>
      <AppShell.Section grow component={ScrollArea}>
        <Stack gap={4}>
          {nav('projects', Library)}
          {project && <><Divider my="sm" /><Text size="xs" c="dimmed" px="sm" truncate title={project.title}>{project.title}</Text>{nav('write', NotebookPen)}{nav('details', FileText)}{nav('world', Globe)}{nav('characters', Network)}{nav('outline', FileText)}{nav('memory', BookOpen)}</>}
          <Divider my="sm" />
          <NavLink component="button" label="资源库" leftSection={<FolderOpen size={21} />} rightSection={<ChevronRight size={18} />} defaultOpened={false} active={route === 'skills' || route === 'research'} childrenOffset={28}>
            <Stack gap={4}>{nav('skills', Puzzle)}{nav('research', TrendingUp)}</Stack>
          </NavLink>
          {nav('training', Puzzle)}
        </Stack>
      </AppShell.Section>
      <AppShell.Section pt="lg">{nav('settings', Settings2)}<Text size="xs" c="dimmed" ta="center" pt="md">StoryAgent{appVersion && ` ${appVersion}`}</Text></AppShell.Section>
    </AppShell.Navbar>
    <AppShell.Main className="main-shell">
      <Group component="header" justify="flex-end" wrap="nowrap" className="app-header">
        <Box hiddenFrom="sm" mr="auto"><IconButton icon={List} label="打开导航" onClick={() => setNavOpened(true)} /></Box>
        {projectRoute && project && <Button primary icon={Sparkles} onClick={() => setAssistantOpen(true)}>小说 AI</Button>}
        {projectRoute && project && <Button icon={Download} onClick={() => setExporting(true)}>导出</Button>}
        <AppUpdateButton store={store} onVersion={setAppVersion} />
      </Group>
      <Box className="main-content"><Suspense fallback={<Center h="100%" w="100%" role="status" aria-label="加载中"><Loader /></Center>}>
        {route === 'projects' && <Projects store={store} onOpen={open} onCreate={() => navigate('create')} />}
        {route === 'create' && <NovelCreation store={store} genre={novelGenre} onGenreChange={setNovelGenre} idea={novelIdea} onIdeaChange={setNovelIdea} onBack={() => navigate('projects')} onOpen={id => { setNovelIdea(''); setNovelGenre(''); open(id); }} onSettings={() => navigate('settings')} />}
        {projectRoute && !project && <Projects store={store} onOpen={open} onCreate={() => navigate('create')} />}
        {route === 'write' && project && <Writing key={project.id + focusRequest} focusJobId={focusJob?.id} project={project} store={store} focusChapterId={focusJob?.steps.find(s => s.chapterId)?.chapterId} onSettings={() => navigate('settings')} />}
        {['details', 'world', 'outline', 'memory'].includes(route) && project && <Knowledge key={project.id + route + focusRequest} focusJobId={focusJob?.id} project={project} store={store} mode={route as 'details' | 'world' | 'outline' | 'memory'} onSettings={() => navigate('settings')} />}
        {route === 'characters' && project && <Characters key={project.id} project={project} store={store} />}
        {route === 'research' && <Research key={focusRequest} store={store} onSettings={() => navigate('settings')} focusJobId={focusJob?.id} />}
        {route === 'skills' && <Skills store={store} />}
        {route === 'training' && <Training key={focusRequest} store={store} onSettings={() => navigate('settings')} focusJobId={focusJob?.id} />}
        {route === 'settings' && <Settings store={store} />}
      </Suspense></Box>
    </AppShell.Main>
    {project && <Suspense fallback={null}><NovelAssistant key={project.id} project={project} store={store} opened={assistantOpen} onClose={() => setAssistantOpen(false)} onSettings={() => { setAssistantOpen(false); navigate('settings'); }} /></Suspense>}
    <ModalPresence>{exporting && project && <Modal title="导出小说" onClose={() => setExporting(false)} footer={<><Button onClick={() => setExporting(false)}>取消</Button><Button primary onClick={() => void exportFile(project.title.replace(/[\/:*?"<>|]/g, '_') + '.' + format, exportNovel(project, format)).then(saved => { if (saved) { store.notify('已导出'); setExporting(false); } }).catch(e => store.notify(String(e)))}>导出</Button></>}><Select label="文件格式" value={format} onChange={v => setFormat(v as 'txt' | 'md')} options={[{ value: 'txt', label: 'TXT' }, { value: 'md', label: 'Markdown' }]} /></Modal>}</ModalPresence>
  </AppShell>;
}
export default App;
