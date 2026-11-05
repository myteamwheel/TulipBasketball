import { currentOutcomeGrade, type ReviewSide } from './tradeReview';
import { formatSigned } from './format';
export const exportGradeColor = (side: ReviewSide, phase: 'atTrade' | 'current') => {
  const grade = phase === 'current' ? currentOutcomeGrade(side) : side.grades?.atTrade;
  return grade?.status === 'INCOMPLETE' || !grade ? '#fcd34d' : grade.result === 'WON' ? '#6ee7b7' : grade.result === 'LOST' ? '#fda4af' : '#cbd5e1';
};
export function wrapExportText(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && measure(line + ' ' + word) > maxWidth) { lines.push(line); line = ''; }
    for (const char of (line ? ' ' : '') + word) {
      if (line && measure(line + char) > maxWidth) { lines.push(line); line = ''; }
      line += char;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}
export function exportGradeLabel(side: ReviewSide, phase: 'atTrade' | 'current') {
  const grade = phase === 'current' ? currentOutcomeGrade(side) : side.grades?.atTrade;
  return `${phase === 'atTrade' ? 'At trade' : 'Now'}: ${grade?.grade ?? (grade?.status === 'EXCLUDED' ? 'FAAB only' : 'Unrated')} · ${grade?.balance ? formatSigned(grade.balance.adjustedEdge) + ' market pts' : 'price coverage incomplete'}`;
}
