import { test } from 'node:test';
import { loadWhiteboardDom, pointerEvent } from './helpers/whiteboard-dom.mjs';
import { checks } from './helpers/check.mjs';

test('whiteboard editing', async (t) => {
  const ck = checks(t);

  const w = loadWhiteboardDom();
  const canvas = w.el('#whiteboardCanvas');
  const send = (t, x, y, e) => canvas.dispatchEvent(pointerEvent(t, x, y, e));

  // Strich verschieben (nicht ausdruecklich gefordert, aber ein Select-Werkzeug,
  // das Striche liegen laesst, waere inkonsistent)
  w.setBoard({ projectId: 'p', updatedAt: 0,
    strokes: [{ id: 'k1', points: [100, 100, 150, 150, 200, 100], width: 2, createdAt: 1 }],
    shapes: [], texts: [] });
  w.setTool('select');
  send('pointerdown', 150, 150);
  ck('stroke can be selected', w.selection() && w.selection().id === 'k1', JSON.stringify(w.selection()));
  send('pointermove', 170, 160);
  send('pointerup', 170, 160);
  ck('all its points moved together', w.board().strokes[0].points.join(',') === '120,110,170,160,220,110', w.board().strokes[0].points.join(','));

  // Entfernen der Auswahl (was der Delete-Handler aufruft)
  w.run("whiteboardSelection = { type: 'stroke', id: 'k1' }; removeWhiteboardItem('stroke', 'k1');");
  ck('removing the selected item empties the board', w.board().strokes.length === 0, String(w.board().strokes.length));
  ck('and clears the selection', w.selection() === null, JSON.stringify(w.selection()));

  // Undo nach dem Zeichnen einer Form
  w.setBoard({ projectId: 'p', updatedAt: 0, strokes: [], shapes: [], texts: [] });
  w.setTool('shape');
  w.el('#whiteboardShapeKind').value = 'ellipse';
  send('pointerdown', 50, 50); send('pointermove', 200, 150); send('pointerup', 200, 150);
  ck('ellipse committed', w.board().shapes.length === 1 && w.board().shapes[0].kind === 'ellipse', w.board().shapes[0]?.kind);
  w.run('undoWhiteboard();');
  ck('undo removes it again', w.board().shapes.length === 0, String(w.board().shapes.length));

  // Zoom veraendert die Trefferschwelle mit
  w.setBoard({ projectId: 'p', updatedAt: 0, strokes: [],
    shapes: [{ id: 's1', kind: 'rect', x: 100, y: 100, w: 100, h: 100, createdAt: 1 }], texts: [] });
  w.run('whiteboardView = { x: 0, y: 0, scale: 4 };');
  w.setTool('select');
  // Bildschirm (400,600) -> Board (100,150), also genau auf der linken Kante
  send('pointerdown', 400, 600);
  ck('hit testing still works when zoomed in', w.selection() && w.selection().id === 's1', JSON.stringify(w.selection()));

  await ck.settled();
});
