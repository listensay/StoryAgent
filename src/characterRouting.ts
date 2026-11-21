import { characterNodeSize, type CharacterRelation } from './characterRelations';

type Point = { x: number; y: number };
type Side = 'left' | 'right' | 'top' | 'bottom';
type Rect = Point & { width: number; height: number };
export type CharacterPort = { id: string; side: Side; offset: number; type: 'source' | 'target' };
type Endpoint = { nodeId: string; port: CharacterPort; point: Point; outer: Point; order: number };
export type CharacterRoute = { id: string; sourceHandle: string; targetHandle: string; points: Point[]; path: string; labelX: number; labelY: number };
const clearance = 24;
const inside = (point: Point, rect: Rect) => point.x > rect.x && point.x < rect.x + rect.width && point.y > rect.y && point.y < rect.y + rect.height;
const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
export function segmentCrossesRect(a: Point, b: Point, rect: Rect) {
  return a.x === b.x
    ? a.x > rect.x && a.x < rect.x + rect.width && Math.max(a.y, b.y) > rect.y && Math.min(a.y, b.y) < rect.y + rect.height
    : a.y > rect.y && a.y < rect.y + rect.height && Math.max(a.x, b.x) > rect.x && Math.min(a.x, b.x) < rect.x + rect.width;
}
function simplify(points: Point[]) {
  return points.filter((point, index) => {
    const before = points[index - 1], after = points[index + 1];
    return !before || !after || !((before.x === point.x && point.x === after.x) || (before.y === point.y && point.y === after.y));
  });
}
function roundedPath(points: Point[]) {
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const before = points[i - 1], point = points[i], after = points[i + 1];
    const radius = Math.min(10, distance(before, point) / 2, distance(point, after) / 2);
    const from = { x: point.x + Math.sign(before.x - point.x) * radius, y: point.y + Math.sign(before.y - point.y) * radius };
    const to = { x: point.x + Math.sign(after.x - point.x) * radius, y: point.y + Math.sign(after.y - point.y) * radius };
    path += ` L ${from.x} ${from.y} Q ${point.x} ${point.y} ${to.x} ${to.y}`;
  }
  const last = points[points.length - 1];
  return `${path} L ${last.x} ${last.y}`;
}

// Route on the free corridors between cards. Bends, shared segments and crossings
// have a cost, so a short direct connection wins whenever it is unobstructed.
function route(start: Point, end: Point, xs: number[], ys: number[], obstacles: Rect[], used: [Point, Point][]) {
  type Step = { x: number; y: number; direction: number; cost: number; score: number; previous?: Step };
  const key = (step: Step) => `${step.x},${step.y},${step.direction}`;
  const first: Step = { x: xs.indexOf(start.x), y: ys.indexOf(start.y), direction: 0, cost: 0, score: distance(start, end) };
  const pending = [first], costs = new Map<string, number>([[key(first), 0]]);
  while (pending.length) {
    let best = 0;
    for (let i = 1; i < pending.length; i++) if (pending[i].score < pending[best].score) best = i;
    const current = pending.splice(best, 1)[0], a = { x: xs[current.x], y: ys[current.y] };
    if (current.cost !== costs.get(key(current))) continue;
    if (a.x === end.x && a.y === end.y) {
      const points: Point[] = [];
      for (let step: Step | undefined = current; step; step = step.previous) points.unshift({ x: xs[step.x], y: ys[step.y] });
      return simplify(points);
    }
    for (const [dx, dy, direction] of [[-1, 0, 1], [1, 0, 1], [0, -1, 2], [0, 1, 2]]) {
      const x = current.x + dx, y = current.y + dy;
      if (x < 0 || y < 0 || x >= xs.length || y >= ys.length) continue;
      const b = { x: xs[x], y: ys[y] };
      if (obstacles.some(rect => inside(b, rect) || segmentCrossesRect(a, b, rect))) continue;
      let penalty = 0;
      for (const [c, d] of used) {
        const horizontal = a.y === b.y, otherHorizontal = c.y === d.y;
        if (horizontal === otherHorizontal) {
          if (horizontal ? a.y === c.y && Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) > Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) : a.x === c.x && Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) > Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y))) penalty += distance(a, b) * 4;
        } else {
          const h1 = horizontal ? a : c, h2 = horizontal ? b : d, v1 = horizontal ? c : a, v2 = horizontal ? d : b;
          if (v1.x >= Math.min(h1.x, h2.x) && v1.x <= Math.max(h1.x, h2.x) && h1.y >= Math.min(v1.y, v2.y) && h1.y <= Math.max(v1.y, v2.y)) penalty += 120;
        }
      }
      const cost = current.cost + distance(a, b) + penalty + (current.direction && current.direction !== direction ? 32 : 0);
      const next: Step = { x, y, direction, cost, score: cost + distance(b, end), previous: current };
      if (cost >= (costs.get(key(next)) ?? Infinity)) continue;
      costs.set(key(next), cost); pending.push(next);
    }
  }
  // Overlapping manually positioned cards can enclose a port completely.
  return [start, { x: end.x, y: start.y }, end];
}

export function routeCharacterRelations(positions: Record<string, Point>, relations: CharacterRelation[]) {
  const rects = Object.values(positions).map(point => ({ ...point, ...characterNodeSize }));
  const obstacles = rects.map(rect => ({ x: rect.x - clearance, y: rect.y - clearance, width: rect.width + clearance * 2, height: rect.height + clearance * 2 }));
  const endpoints = new Map<string, Endpoint[]>();
  const ports: Record<string, CharacterPort[]> = Object.fromEntries(Object.keys(positions).map(id => [id, []]));
  const pairs = relations.filter(relation => positions[relation.sourceId] && positions[relation.targetId]).map(relation => {
    const source = positions[relation.sourceId], target = positions[relation.targetId];
    const dx = target.x - source.x, dy = target.y - source.y;
    const horizontal = Math.abs(dx) / characterNodeSize.width >= Math.abs(dy) / characterNodeSize.height;
    const sides: Side[] = horizontal ? dx >= 0 ? ['right', 'left'] : ['left', 'right'] : dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
    const ends = [relation.sourceId, relation.targetId].map((nodeId, index): Endpoint => {
      const port: CharacterPort = { id: `${relation.id}-${index}`, side: sides[index], offset: 50, type: index ? 'target' : 'source' };
      const end = { nodeId, port, point: { x: 0, y: 0 }, outer: { x: 0, y: 0 }, order: horizontal ? (index ? source.y : target.y) : (index ? source.x : target.x) };
      const key = `${nodeId}-${port.side}`;
      endpoints.set(key, [...(endpoints.get(key) ?? []), end]);
      ports[nodeId].push(port);
      return end;
    });
    return { relation, ends };
  });
  for (const group of endpoints.values()) group.sort((a, b) => a.order - b.order || a.port.id.localeCompare(b.port.id)).forEach((end, index) => {
    const origin = positions[end.nodeId], { width, height } = characterNodeSize;
    end.port.offset = (index + 1) / (group.length + 1) * 100;
    const along = end.port.offset / 100;
    end.point = { x: origin.x + (end.port.side === 'left' ? 0 : end.port.side === 'right' ? width : width * along), y: origin.y + (end.port.side === 'top' ? 0 : end.port.side === 'bottom' ? height : height * along) };
    end.outer = { x: end.point.x + (end.port.side === 'left' ? -clearance : end.port.side === 'right' ? clearance : 0), y: end.point.y + (end.port.side === 'top' ? -clearance : end.port.side === 'bottom' ? clearance : 0) };
  });
  const allEnds = pairs.flatMap(pair => pair.ends);
  const sorted = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);
  const xs = sorted([...obstacles.flatMap(rect => [rect.x - 24, rect.x, rect.x + rect.width, rect.x + rect.width + 24]), ...allEnds.map(end => end.outer.x)]);
  const ys = sorted([...obstacles.flatMap(rect => [rect.y - 24, rect.y, rect.y + rect.height, rect.y + rect.height + 24]), ...allEnds.map(end => end.outer.y)]);
  const used: [Point, Point][] = [], labels: Rect[] = [], routes: CharacterRoute[] = [];
  for (const { relation, ends: [source, target] } of pairs.sort((a, b) => distance(a.ends[0].point, a.ends[1].point) - distance(b.ends[0].point, b.ends[1].point))) {
    const points = simplify([source.point, ...route(source.outer, target.outer, xs, ys, obstacles, used), target.point]);
    const width = Math.min(10, relation.title.length) * 14 + 20, height = 32;
    const candidates = points.slice(1).flatMap((b, index) => {
      const a = points[index];
      return [.5, .25, .75].map(fraction => {
        const x = a.x + (b.x - a.x) * fraction, y = a.y + (b.y - a.y) * fraction;
        const rect = { x: x - width / 2, y: y - height / 2, width, height };
        const collisions = [...rects, ...labels].filter(other => overlaps(rect, other)).length;
        return { x, y, rect, score: collisions * 10000 + (a.y === b.y ? 0 : 100) - Math.min(distance(a, b), width + 40) + Math.abs(fraction - .5) * 20 };
      });
    }).sort((a, b) => a.score - b.score);
    const label = candidates[0]; labels.push(label.rect);
    routes.push({ id: relation.id, sourceHandle: source.port.id, targetHandle: target.port.id, points, path: roundedPath(points), labelX: label.x, labelY: label.y });
    points.slice(1).forEach((point, index) => used.push([points[index], point]));
  }
  return { ports, routes };
}
