// Dessin des zones annotées. Les coordonnées sont normalisées (0 à 1) par rapport à l'image vidéo.
export const SHAPE_NAMES = { rect: 'zone', ellipse: 'cercle', arrow: 'flèche', pen: 'tracé', pin: 'point' };

export function drawShapes(ctx, shapes, rect, opts = {}) {
  const scale = opts.scale || 1;
  const lw = Math.max(2, 3 * scale);
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  shapes.forEach((s, i) => {
    const X = (x) => rect.x + x * rect.w;
    const Y = (y) => rect.y + y * rect.h;
    ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = lw;
    ctx.globalAlpha = opts.alpha == null ? 1 : opts.alpha;
    ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 4 * scale;
    let lx; let ly;
    if (s.type === 'rect') {
      ctx.strokeRect(X(s.x), Y(s.y), s.w * rect.w, s.h * rect.h);
      ctx.globalAlpha *= 0.1; ctx.fillRect(X(s.x), Y(s.y), s.w * rect.w, s.h * rect.h); ctx.globalAlpha /= 0.1;
      lx = X(s.x); ly = Y(s.y);
    } else if (s.type === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(X(s.x + s.w / 2), Y(s.y + s.h / 2), Math.abs(s.w * rect.w / 2), Math.abs(s.h * rect.h / 2), 0, 0, Math.PI * 2);
      ctx.stroke();
      lx = X(s.x + s.w / 2 - s.w / 2 * 0.707); ly = Y(s.y + s.h / 2 - s.h / 2 * 0.707);
    } else if (s.type === 'arrow') {
      const x1 = X(s.x1); const y1 = Y(s.y1); const x2 = X(s.x2); const y2 = Y(s.y2);
      const a = Math.atan2(y2 - y1, x2 - x1); const head = Math.max(12, 18 * scale);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(a - 0.45), y2 - head * Math.sin(a - 0.45));
      ctx.lineTo(x2 - head * Math.cos(a + 0.45), y2 - head * Math.sin(a + 0.45));
      ctx.closePath(); ctx.fill();
      lx = x1; ly = y1;
    } else if (s.type === 'pen') {
      ctx.beginPath();
      s.points.forEach(([x, y], k) => (k ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      ctx.stroke();
      lx = X(s.points[0][0]); ly = Y(s.points[0][1]);
    } else if (s.type === 'pin') {
      const r = Math.max(9, 13 * scale);
      ctx.beginPath(); ctx.arc(X(s.x), Y(s.y), r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(X(s.x), Y(s.y), r * 0.28, 0, Math.PI * 2); ctx.fill();
      lx = X(s.x) - r; ly = Y(s.y) - r;
    }
    if (opts.labels && shapes.length > 0) badge(ctx, String(i + 1), lx, ly, s.color, scale);
  });
  ctx.restore();
}

function badge(ctx, label, x, y, color, scale) {
  const r = Math.max(9, 12 * scale);
  ctx.save();
  ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
  ctx.fillStyle = color.toLowerCase() === '#ffffff' || color === '#ffb020' || color === '#2ed3a4' ? '#0b0d10' : '#ffffff';
  ctx.font = '700 ' + Math.round(r * 1.15) + 'px -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y + 0.5);
  ctx.restore();
}

export function shapeBounds(s) {
  if (s.type === 'rect' || s.type === 'ellipse') {
    return { x: Math.min(s.x, s.x + s.w), y: Math.min(s.y, s.y + s.h), w: Math.abs(s.w), h: Math.abs(s.h) };
  }
  if (s.type === 'arrow') return { x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2), w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) };
  if (s.type === 'pin') return { x: s.x, y: s.y, w: 0, h: 0 };
  const xs = s.points.map((p) => p[0]); const ys = s.points.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

export function placeName(b) {
  const cx = b.x + b.w / 2; const cy = b.y + b.h / 2;
  const v = cy < 0.33 ? 'en haut' : cy > 0.67 ? 'en bas' : 'au milieu';
  const h = cx < 0.33 ? 'à gauche' : cx > 0.67 ? 'à droite' : 'au centre';
  if (v === 'au milieu' && h === 'au centre') return 'au centre de l\'image';
  if (v === 'au milieu') return 'au milieu ' + h;
  return v + ' ' + h;
}
