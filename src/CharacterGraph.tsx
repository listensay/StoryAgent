import { useCallback, useEffect, useMemo, useState } from 'react';
import { Background, BaseEdge, Handle, Position, ReactFlow, ReactFlowProvider, useNodesInitialized, useNodesState, useReactFlow, useUpdateNodeInternals, type Node, type NodeProps, type Edge, type EdgeProps, type OnNodesChange } from '@xyflow/react';
import { Box, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { Button, EmptyState, Paper } from './components';
import { buildCharacterGraph, characterNodeSize, characterPositions, layoutCharacters, newCharacterRelation } from './characterRelations';
import { routeCharacterRelations, type CharacterPort, type CharacterRoute } from './characterRouting';
import type { Note } from './domain';
import '@xyflow/react/style.css';
import './CharacterGraph.css';

type CharacterNodeType = Node<{ title: string; description: string; ports: CharacterPort[]; edit: () => void }, 'character'>;
type RelationEdgeType = Edge<CharacterRoute, 'relation'>;
const nodeTypes = { character: CharacterNode };
const edgeTypes = { relation: RelationEdge };

function RelationEdge({ data, id, label, labelStyle, labelShowBg, labelBgStyle, labelBgPadding, labelBgBorderRadius, style, interactionWidth }: EdgeProps<RelationEdgeType>) {
  if (!data) return null;
  return <BaseEdge id={id} path={data.path} labelX={data.labelX} labelY={data.labelY} label={label} labelStyle={labelStyle} labelShowBg={labelShowBg} labelBgStyle={labelBgStyle} labelBgPadding={labelBgPadding} labelBgBorderRadius={labelBgBorderRadius} style={style} interactionWidth={interactionWidth} />;
}

function CharacterNode({ id, data, selected }: NodeProps<CharacterNodeType>) {
  const updateInternals = useUpdateNodeInternals();
  const portKey = JSON.stringify(data.ports);
  useEffect(() => { updateInternals(id); }, [id, portKey, updateInternals]);
  return <Paper className="character-node" p="sm" shadow="xs" style={{ borderColor: `var(--mantine-color-${selected ? 'story-7' : 'gray-3'})` }}>
    {data.ports.map(port => <Handle key={port.id} id={port.id} type={port.type} position={{ left: Position.Left, right: Position.Right, top: Position.Top, bottom: Position.Bottom }[port.side]} style={port.side === 'left' || port.side === 'right' ? { top: `${port.offset}%` } : { left: `${port.offset}%` }} isConnectable={false} />)}
    <Stack gap={4}><UnstyledButton className="nodrag character-name" aria-label={`编辑人物${data.title}`} onClick={data.edit}>{data.title}</UnstyledButton><Text size="sm" c="dimmed" lineClamp={1}>{data.description || '人物'}</Text></Stack>
  </Paper>;
}

type Props = { notes: Note[]; onEdit: (note: Note) => void; onPositions: (positions: Record<string, { x: number; y: number }>) => void };
export function CharacterGraph(props: Props) {
  return <ReactFlowProvider><CharacterGraphCanvas {...props} /></ReactFlowProvider>;
}
function CharacterGraphCanvas({ notes, onEdit, onPositions }: Props) {
  const graph = useMemo(() => buildCharacterGraph(notes), [notes]);
  const layout = useMemo(() => layoutCharacters(graph.characters, graph.relations), [graph]);
  const positions = useMemo(() => characterPositions(graph.characters, layout), [graph, layout]);
  const [nodes, setNodes, onNodesChange] = useNodesState<CharacterNodeType>([]);
  const [focusedNode, setFocusedNode] = useState<string>();
  const [hoveredEdge, setHoveredEdge] = useState<string>();
  const initialized = useNodesInitialized();
  const { fitView, zoomIn, zoomOut } = useReactFlow<CharacterNodeType>();
  const updateNodes = useCallback<OnNodesChange<CharacterNodeType>>(changes => {
    onNodesChange(changes);
    const positions: Record<string, { x: number; y: number }> = {};
    for (const change of changes) if (change.type === 'position' && change.position && !change.dragging) positions[change.id] = change.position;
    if (Object.keys(positions).length) onPositions(positions);
  }, [onNodesChange, onPositions]);
  const editRelation = useCallback((id: string) => {
    const relation = graph.relations.find(value => value.id === id);
    if (!relation) return;
    onEdit(notes.find(note => note.id === relation.noteId) ?? newCharacterRelation(relation.sourceId, relation.targetId, relation.title, relation.body));
  }, [graph, notes, onEdit]);
  useEffect(() => {
    setNodes(previous => graph.characters.map(character => {
      const existing = previous.find(node => node.id === character.id);
      return {
        ...existing, id: character.id, type: 'character', position: existing?.dragging ? existing.position : positions[character.id],
        ...characterNodeSize, ariaLabel: `人物：${character.title}`,
        data: { ports: [], title: character.title, description: character.body.split('\n').find(line => line.trim())?.replace(/^[#\s*]*(?:身份与作用|身份)[：:]\s*/, '') ?? '', edit: () => onEdit({ ...character }) },
      };
    }));
  }, [graph, positions, onEdit, setNodes]);
  useEffect(() => {
    if (!initialized) return;
    const frame = requestAnimationFrame(() => void fitView({ padding: 40, maxZoom: 1 }));
    return () => cancelAnimationFrame(frame);
  }, [initialized, fitView]);
  const routing = useMemo(() => routeCharacterRelations(Object.fromEntries(nodes.map(node => [node.id, node.position])), graph.relations), [nodes, graph.relations]);
  const displayedNodes = nodes.map(node => ({ ...node, data: { ...node.data, ports: routing.ports[node.id] ?? [] } }));
  const edges: RelationEdgeType[] = graph.relations.flatMap(relation => {
    const route = routing.routes.find(value => value.id === relation.id);
    if (!route) return [];
    const highlighted = hoveredEdge === relation.id || focusedNode === relation.sourceId || focusedNode === relation.targetId;
    const dimmed = (!!focusedNode || !!hoveredEdge) && !highlighted;
    return [{
      id: relation.id, source: relation.sourceId, target: relation.targetId, sourceHandle: route.sourceHandle, targetHandle: route.targetHandle,
      label: dimmed || (graph.relations.length > 12 && hoveredEdge !== relation.id) ? undefined : relation.title.length > 10 ? `${relation.title.slice(0, 10)}…` : relation.title,
      ariaLabel: `人物关系：${graph.characters.find(character => character.id === relation.sourceId)?.title}与${graph.characters.find(character => character.id === relation.targetId)?.title}，${relation.title}`,
      style: { stroke: highlighted ? '#b44000' : '#8a8a8a', strokeWidth: highlighted ? 2.5 : 1.5, opacity: dimmed ? .18 : 1 }, labelStyle: { fill: '#595959', fontSize: 14 }, labelBgStyle: { fill: '#fff', fillOpacity: .96 }, labelBgPadding: [10, 6] as [number, number], labelBgBorderRadius: 6,
      type: 'relation' as const, data: route, zIndex: highlighted ? 1 : 0,
      domAttributes: { onKeyDown: (event: React.KeyboardEvent<SVGGElement>) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); editRelation(relation.id); } } },
    }];
  });
  const arrange = () => { onPositions(layout); setNodes(previous => previous.map(node => ({ ...node, position: layout[node.id] }))); requestAnimationFrame(() => void fitView({ padding: 40, maxZoom: 1 })); };
  return <Stack gap="md">
    <Group justify="flex-end" gap="sm"><Button disabled={!nodes.length} onClick={arrange}>自动布局</Button><Button disabled={!nodes.length} onClick={() => void fitView({ padding: 40, maxZoom: 1 })}>适应视图</Button><Button disabled={!nodes.length} onClick={() => void zoomOut()}>缩小</Button><Button disabled={!nodes.length} onClick={() => void zoomIn()}>放大</Button></Group>
    <Box className="character-graph" h={520}>{!graph.characters.length ? <EmptyState minHeight={520}>暂无人物</EmptyState> : <ReactFlow<CharacterNodeType, RelationEdgeType>
      nodes={displayedNodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={updateNodes}
      onNodeClick={(_, node) => setFocusedNode(node.id)} onPaneClick={() => setFocusedNode(undefined)}
      onEdgeMouseEnter={(_, edge) => setHoveredEdge(edge.id)} onEdgeMouseLeave={() => setHoveredEdge(undefined)}
      onEdgeClick={(_, edge) => editRelation(edge.id)}
      nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null} nodeDragThreshold={0}
      zoomOnScroll={false} preventScrolling={false}
      fitView fitViewOptions={{ padding: 40, maxZoom: 1 }} minZoom={0.2} maxZoom={1.6}
      ariaLabelConfig={{ 'node.a11yDescription.default': '人物节点', 'node.a11yDescription.keyboardDisabled': '人物节点', 'edge.a11yDescription.default': '人物关系', 'handle.ariaLabel': '关系连接点', 'node.a11yDescription.ariaLiveMessage': ({ x, y }) => `人物位置：${Math.round(x)}，${Math.round(y)}` }}
    ><Background color="#e6e6e6" gap={24} size={1} /></ReactFlow>}</Box>
    {focusedNode && <Stack gap="sm"><Text fw={500}>{graph.characters.find(character => character.id === focusedNode)?.title}</Text>{graph.relations.filter(relation => relation.sourceId === focusedNode || relation.targetId === focusedNode).map(relation => <Group key={relation.id} wrap="nowrap"><Text size="sm" style={{ flex: 1, overflowWrap: 'anywhere' }}>{graph.characters.find(character => character.id === (relation.sourceId === focusedNode ? relation.targetId : relation.sourceId))?.title} · {relation.title}</Text><Button aria-label={`编辑关系${relation.title}`} onClick={() => editRelation(relation.id)}>编辑</Button></Group>)}</Stack>}
    {!!graph.unlinked.length && <Stack gap="xs"><Text size="sm" c="dimmed">未关联的人物关系</Text><Group gap="sm">{graph.unlinked.map(note => <Button key={note.id} onClick={() => onEdit({ ...note })}>{note.title || '人物关系'}</Button>)}</Group></Stack>}
  </Stack>;
}
