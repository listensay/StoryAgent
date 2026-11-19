import { HugeiconsIcon, type HugeiconsIconProps, type IconSvgElement } from '@hugeicons/react';
import {
  Add01Icon, Cancel01Icon, ArrowDown01Icon, ArrowUp01Icon, ArrowRight01Icon,
  BookOpen01Icon, QuillWrite01Icon, File01Icon, LibraryIcon, WorkflowCircle01Icon,
  Notebook01Icon, PuzzleIcon, Settings02Icon, AiSparklesIcon, AnalyticsUpIcon,
  Copy01Icon, Clock01Icon, FloppyDiskIcon, Download01Icon, Upload01Icon,
  Delete02Icon, Globe02Icon, Github01Icon, FolderOpenIcon, RefreshIcon,
  PlayIcon, PauseIcon, Tick02Icon, GitCompareIcon, Menu01Icon, ServerStack01Icon,
} from '@hugeicons/core-free-icons';

type IconProps = Omit<HugeiconsIconProps, 'icon'>;
export type AppIcon = (props: IconProps) => React.ReactElement;
function icon(data: IconSvgElement): AppIcon {
  return function Icon(props) { return <HugeiconsIcon icon={data} size={20} strokeWidth={1.7} aria-hidden="true" {...props} />; };
}

export const Plus = icon(Add01Icon);
export const X = icon(Cancel01Icon);
export const ArrowDown = icon(ArrowDown01Icon);
export const ArrowUp = icon(ArrowUp01Icon);
export const ChevronDown = icon(ArrowDown01Icon);
export const ChevronUp = icon(ArrowUp01Icon);
export const ChevronRight = icon(ArrowRight01Icon);
export const BookOpen = icon(BookOpen01Icon);
export const Feather = icon(QuillWrite01Icon);
export const FileText = icon(File01Icon);
export const FileUp = icon(Upload01Icon);
export const Library = icon(LibraryIcon);
export const Network = icon(WorkflowCircle01Icon);
export const NotebookPen = icon(Notebook01Icon);
export const Puzzle = icon(PuzzleIcon);
export const Settings2 = icon(Settings02Icon);
export const Sparkles = icon(AiSparklesIcon);
export const TrendingUp = icon(AnalyticsUpIcon);
export const Copy = icon(Copy01Icon);
export const History = icon(Clock01Icon);
export const Save = icon(FloppyDiskIcon);
export const Download = icon(Download01Icon);
export const Upload = icon(Upload01Icon);
export const Trash2 = icon(Delete02Icon);
export const Globe = icon(Globe02Icon);
export const Github = icon(Github01Icon);
export const FolderOpen = icon(FolderOpenIcon);
export const RefreshCw = icon(RefreshIcon);
export const Play = icon(PlayIcon);
export const Pause = icon(PauseIcon);
export const Check = icon(Tick02Icon);
export const GitCompare = icon(GitCompareIcon);
export const List = icon(Menu01Icon);
export const Server = icon(ServerStack01Icon);
