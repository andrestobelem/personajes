import type { ConversationView } from '../domain/run-observation.ts';

/** Escape script syntax inside recorded speech/labels. Notes and boneyards must
 * never turn a spoken [[secret]] or slash-star into hidden screenplay content. */
export function fountainLiteral(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[\\*_\[\]^]/g, character => `\\${character}`).split('\n')
    .map(line => line.length === 0 ? '  ' : line.replace(/^([(.!@#=~><])/, '\\$1')).join('\n');
}
export function fountainLine(value: string): string { return fountainLiteral(value.replace(/[\r\n]+/g, ' ')).trim(); }
export function fountainDialogue(speaker: string, text: string): string { return `@${fountainLine(speaker).toLocaleUpperCase('es')}\n${fountainLiteral(text)}\n`; }
const gestures = { wave: 'saluda con la mano', point: 'señala', nod: 'asiente', shakeHead: 'niega con la cabeza', posture: 'cambia de postura', bark: 'ladra', whine: 'gime' };
export function fountainCommunication(value: ConversationView): string {
  return value.content.kind === 'speech' ? fountainDialogue(value.speaker.label, value.content.text)
    : `!${fountainLine(value.speaker.label)} ${gestures[value.content.gesture.kind]}.\n`;
}
