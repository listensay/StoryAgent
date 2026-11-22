import type { TrainingAnnotation } from './domain';

// Split at every boundary so overlapping comments retain their own exact ranges.
export function annotationSegments(content: string, annotations: TrainingAnnotation[]) {
  const valid = annotations.map((annotation, index) => ({ ...annotation, index })).filter(a => a.start >= 0 && a.end > a.start && a.end <= content.length && content.slice(a.start, a.end) === a.quote);
  const boundaries = [...new Set([0, content.length, ...valid.flatMap(a => [a.start, a.end])])].sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((start, i) => ({ start, text: content.slice(start, boundaries[i + 1]), annotations: valid.filter(a => a.start <= start && a.end >= boundaries[i + 1]).map(a => a.index) }));
}
