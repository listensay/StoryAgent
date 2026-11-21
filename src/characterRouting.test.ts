import { describe, expect, it } from 'vitest';
import { routeCharacterRelations, segmentCrossesRect } from './characterRouting';
import { characterNodeSize, type CharacterRelation } from './characterRelations';

const relation = (id: string, sourceId: string, targetId: string): CharacterRelation => ({ id, sourceId, targetId, title: '同伴', body: '' });
describe('人物关系连线', () => {
  it('同列连接使用上下端点，并为同一对人物的多条关系分配独立路径', () => {
    const result = routeCharacterRelations({ a: { x: 100, y: 0 }, b: { x: 100, y: 320 } }, [relation('one', 'a', 'b'), relation('two', 'b', 'a')]);
    expect(result.ports.a.every(port => port.side === 'bottom')).toBe(true);
    expect(result.ports.b.every(port => port.side === 'top')).toBe(true);
    expect(new Set(result.routes.map(route => route.path)).size).toBe(2);
    expect(new Set(result.ports.a.map(port => port.offset)).size).toBe(2);
  });
  it('跨层连线绕过中间人物，手动拖动后仍然避开卡片', () => {
    for (const y of [0, 18, -28]) {
      const positions = { a: { x: 0, y: 0 }, obstacle: { x: 340, y }, b: { x: 700, y: 0 } };
      const { routes } = routeCharacterRelations(positions, [relation('long', 'a', 'b')]);
      const rect = { ...positions.obstacle, ...characterNodeSize };
      expect(routes).toHaveLength(1);
      routes[0].points.slice(1).forEach((point, index) => {
        expect(segmentCrossesRect(routes[0].points[index], point, rect)).toBe(false);
      });
    }
  });
  it('多分支和环状关系的连线不穿过无关人物，空图不产生路径', () => {
    expect(routeCharacterRelations({}, [])).toEqual({ ports: {}, routes: [] });
    const positions = { a: { x: 0, y: 160 }, b: { x: 400, y: 0 }, c: { x: 400, y: 320 }, d: { x: 800, y: 160 } };
    const relations = [relation('ab', 'a', 'b'), relation('ac', 'a', 'c'), relation('bd', 'b', 'd'), relation('cd', 'c', 'd'), relation('ad', 'a', 'd'), relation('bc', 'b', 'c')];
    const { routes } = routeCharacterRelations(positions, relations);
    expect(routes).toHaveLength(relations.length);
    routes.forEach(route => {
      const edge = relations.find(value => value.id === route.id)!;
      expect(Number.isFinite(route.labelX + route.labelY)).toBe(true);
      for (const [id, position] of Object.entries(positions)) if (id !== edge.sourceId && id !== edge.targetId) {
        route.points.slice(1).forEach((point, index) => expect(segmentCrossesRect(route.points[index], point, { ...position, ...characterNodeSize })).toBe(false));
      }
    });
  });
});
