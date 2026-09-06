import { test } from 'node:test';
import { loadWhiteboardDom, pointerEvent } from './helpers/whiteboard-dom.mjs';
import { checks } from './helpers/check.mjs';

test('whiteboard interaction', async (t) => {
  const ck = checks(t);

  const w = loadWhiteboardDom();
  const canvas = w.el('#whiteboardCanvas');
  const send = (type, x, y, extra) => canvas.dispatchEvent(pointerEvent(type, x, y, extra));
  const empty = () => ({ projectId: 'p', strokes: [], shapes: [], texts: [], updatedAt: 0 });

  // --- Rechteck ziehen ---
  w.setBoard(empty());
  w.setTool('shape');
  w.el('#whiteboardShapeKind').value = 'rect';
  send('pointerdown', 100, 100);
  send('pointermove', 260, 220);
  ck('a shape preview exists while dragging', !!w.run('whiteboardShapeDraft'));
  ck('nothing committed yet', w.board().shapes.length === 0);
  send('pointerup', 260, 220);
  let b = w.board();
  ck('rectangle committed on release', b.shapes.length === 1, String(b.shapes.length));
  ck('with the dragged geometry', b.shapes[0].x === 100 && b.shapes[0].y === 100 && b.shapes[0].w === 160 && b.shapes[0].h === 120,
    JSON.stringify([b.shapes[0].x, b.shapes[0].y, b.shapes[0].w, b.shapes[0].h]));
  ck('and saved once', w.saves() === 1, String(w.saves()));

  // --- Klick ohne Ziehen darf keine Null-Form hinterlassen ---
  const before = w.board().shapes.length;
  send('pointerdown', 400, 400);
  send('pointerup', 400, 400);
  ck('a click without a drag leaves nothing', w.board().shapes.length === before, String(w.board().shapes.length));

  // --- Shift erzwingt Quadrat ---
  w.setBoard(empty());
  send('pointerdown', 0, 0);
  send('pointermove', 200, 60, { shiftKey: true });
  send('pointerup', 200, 60, { shiftKey: true });
  b = w.board();
  ck('shift makes it square', Math.abs(b.shapes[0].w) === Math.abs(b.shapes[0].h), `${b.shapes[0].w}x${b.shapes[0].h}`);

  // --- Shift erzwingt gerade Linie ---
  w.setBoard(empty());
  w.el('#whiteboardShapeKind').value = 'line';
  send('pointerdown', 0, 0);
  send('pointermove', 200, 30, { shiftKey: true });
  send('pointerup', 200, 30, { shiftKey: true });
  b = w.board();
  ck('shift straightens a line', b.shapes[0].h === 0 && b.shapes[0].w === 200, `${b.shapes[0].w},${b.shapes[0].h}`);

  // --- Auswaehlen und Verschieben einer Form ---
  w.setBoard({ projectId: 'p', updatedAt: 0, strokes: [],
    shapes: [{ id: 's1', kind: 'rect', x: 100, y: 100, w: 100, h: 100, width: 2, createdAt: 1 }],
    texts: [{ id: 't1', x: 400, y: 400, text: 'label', size: 18, createdAt: 2 }] });
  w.setTool('select');
  send('pointerdown', 100, 150);          // linke Kante
  ck('clicking an edge selects the shape', w.selection() && w.selection().id === 's1', JSON.stringify(w.selection()));
  send('pointermove', 140, 170);
  send('pointerup', 140, 170);
  b = w.board();
  ck('shape followed the drag', b.shapes[0].x === 140 && b.shapes[0].y === 120, `${b.shapes[0].x},${b.shapes[0].y}`);
  ck('one save for the whole drag', w.saves() === 1, String(w.saves()));

  // --- Text verschieben ---
  const savesBefore = w.saves();
  send('pointerdown', 410, 405);
  ck('clicking text selects it', w.selection() && w.selection().id === 't1', JSON.stringify(w.selection()));
  send('pointermove', 460, 425);
  send('pointerup', 460, 425);
  b = w.board();
  ck('text followed the drag', b.texts[0].x === 450 && b.texts[0].y === 420, `${b.texts[0].x},${b.texts[0].y}`);
  ck('drag saved once more', w.saves() === savesBefore + 1, String(w.saves()));

  // --- Klick ins Leere hebt die Auswahl auf und verschiebt nichts ---
  const snapshot = JSON.stringify(w.board());
  send('pointerdown', 700, 100);
  ck('clicking empty space clears the selection', w.selection() === null, JSON.stringify(w.selection()));
  send('pointermove', 760, 160);
  send('pointerup', 760, 160);
  ck('and moves nothing', JSON.stringify(w.board()) === snapshot);

  // --- Auswaehlen ohne Ziehen loest kein Speichern aus ---
  const s0 = w.saves();
  send('pointerdown', 450, 425);
  send('pointerup', 450, 425);
  ck('a plain select does not save', w.saves() === s0, `${s0} -> ${w.saves()}`);

  // --- Werkzeugwechsel verwirft die Auswahl ---
  send('pointerdown', 450, 425);
  w.setTool('pen');
  ck('switching tools clears the selection', w.selection() === null);

  await ck.settled();
});
