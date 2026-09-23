"""Small inline-SVG chart kit for the report (theme tokens via CSS classes; hover via data-v / data-l)."""
import html, math
esc = lambda s: html.escape(str(s), quote=True)

def ticks(lo, hi, n=5):
    span = hi - lo
    raw = span / n
    mag = 10 ** math.floor(math.log10(raw)) if raw > 0 else 1
    step = min([1, 2, 2.5, 5, 10], key=lambda m: abs(m * mag - raw)) * mag
    t = math.ceil(lo / step) * step
    out = []
    while t <= hi + 1e-9:
        out.append(round(t, 10)); t += step
    return out

def tipattrs(v, l):
    return f'data-v="{esc(v)}" data-l="{esc(l)}" tabindex="0"'

def forest(rows, lo, hi, fmt, width=720, label_w=200, val_w=150, row_h=30, aria="", vs=True):
    """rows: dict(label, brett, mean, lo, hi, tip) — Brett's dot vs the null band (95%) and mean tick."""
    plot_w = width - label_w - val_w - 16
    X = lambda v: label_w + (min(max(v, lo), hi) - lo) / (hi - lo) * plot_w
    top = 10; h = top + row_h * len(rows) + 28
    p = [f'<svg class="chart" viewBox="0 0 {width} {h}" role="img" aria-label="{esc(aria)}">']
    for t in ticks(lo, hi):
        x = X(t); p.append(f'<line class="grid" x1="{x:.1f}" x2="{x:.1f}" y1="{top-4}" y2="{h-24}"/>')
        p.append(f'<text class="axis" x="{x:.1f}" y="{h-8}" text-anchor="middle">{esc(fmt(t))}</text>')
    for i, r in enumerate(rows):
        cy = top + row_h * i + row_h / 2
        p.append(f'<g class="hit" {tipattrs(r.get("tipv", fmt(r["brett"])), r["tip"])}>')
        p.append(f'<rect class="hitbox" x="0" y="{cy-row_h/2:.1f}" width="{width}" height="{row_h}"/>')
        p.append(f'<text class="lab" x="{label_w-12}" y="{cy+4:.1f}" text-anchor="end">{esc(r["label"])}</text>')
        x0, x1 = X(r["lo"]), X(r["hi"])
        p.append(f'<rect class="band" x="{x0:.1f}" y="{cy-4:.1f}" width="{max(x1-x0,2):.1f}" height="8" rx="4"/>')
        p.append(f'<line class="meantick" x1="{X(r["mean"]):.1f}" x2="{X(r["mean"]):.1f}" y1="{cy-8:.1f}" y2="{cy+8:.1f}"/>')
        p.append(f'<circle class="dot-me" cx="{X(r["brett"]):.1f}" cy="{cy:.1f}" r="5.5"/>')
        soft = f'<tspan class="soft"> vs {esc(fmt(r["mean"]))}</tspan>' if vs else ""
        p.append(f'<text class="val" x="{label_w+plot_w+16}" y="{cy+4:.1f}"><tspan class="strong">{esc(fmt(r["brett"]))}</tspan>{soft}</text>')
        p.append('</g>')
    p.append('</svg>')
    return "".join(p)

def legend(items):
    """items: list of (css-class, label, kind) kind in {'dot','band','tick','bar','bar2'}"""
    out = ['<div class="legend">']
    for cls, lab, kind in items:
        out.append(f'<span class="key"><span class="sw sw-{kind} {cls}"></span>{esc(lab)}</span>')
    out.append('</div>')
    return "".join(out)

def diverging(rows, width=720, label_w=64, row_h=20, fmt=lambda v: f"{v:+.1f}", aria="", headroom=1.0):
    """rows: dict(label, value, tip). Positive = over-exposed (accent), negative = under (red). headroom > 1 leaves room for end labels."""
    vmax = (max(abs(r["value"]) for r in rows) or 1) * headroom
    lim = math.ceil(vmax / 5) * 5
    plot_w = width - label_w - 70
    X = lambda v: label_w + (v + lim) / (2 * lim) * plot_w
    top = 6; h = top + row_h * len(rows) + 26
    p = [f'<svg class="chart" viewBox="0 0 {width} {h}" role="img" aria-label="{esc(aria)}">']
    for t in ticks(-lim, lim, 4):
        x = X(t); p.append(f'<line class="grid" x1="{x:.1f}" x2="{x:.1f}" y1="{top}" y2="{h-22}"/>')
        p.append(f'<text class="axis" x="{x:.1f}" y="{h-6}" text-anchor="middle">{esc(fmt(t) if t else "0")}</text>')
    x0 = X(0)
    for i, r in enumerate(rows):
        cy = top + row_h * i + row_h / 2
        v = r["value"]; xa, xb = sorted([x0, X(v)])
        cls = "bar-over" if v >= 0 else "bar-under"
        w = max(xb - xa, 1.5)
        p.append(f'<g class="hit" {tipattrs(r.get("tipv", fmt(v)), r["tip"])}>')
        p.append(f'<rect class="hitbox" x="0" y="{cy-row_h/2:.1f}" width="{width}" height="{row_h}"/>')
        p.append(f'<text class="lab mono" x="{label_w-10}" y="{cy+4:.1f}" text-anchor="end">{esc(r["label"])}</text>')
        rx = min(3, w / 2)
        p.append(f'<rect class="{cls}" x="{xa:.1f}" y="{cy-6:.1f}" width="{w:.1f}" height="12" rx="{rx:.1f}"/>')
        if r.get("show"):
            tx = X(v) + (6 if v >= 0 else -6)
            p.append(f'<text class="val strong" x="{tx:.1f}" y="{cy+4:.1f}" text-anchor="{"start" if v >= 0 else "end"}">{esc(r["show"])}</text>')
        p.append('</g>')
    p.append(f'<line class="baseline" x1="{x0:.1f}" x2="{x0:.1f}" y1="{top}" y2="{h-22}"/>')
    p.append('</svg>')
    return "".join(p)

def paired(rows, vmax, fmt, width=720, label_w=170, val_w=110, aria="", a_cls="bar-me", b_cls="bar-base"):
    """Two horizontal bars per category: rows dict(label, a, b, tip). a = Brett, b = baseline."""
    plot_w = width - label_w - val_w - 12
    X = lambda v: label_w + max(v, 0) / vmax * plot_w
    grp_h = 30; top = 6; h = top + grp_h * len(rows) + 26
    p = [f'<svg class="chart" viewBox="0 0 {width} {h}" role="img" aria-label="{esc(aria)}">']
    for t in ticks(0, vmax, 4):
        x = X(t); p.append(f'<line class="grid" x1="{x:.1f}" x2="{x:.1f}" y1="{top}" y2="{h-22}"/>')
        p.append(f'<text class="axis" x="{x:.1f}" y="{h-6}" text-anchor="middle">{esc(fmt(t))}</text>')
    for i, r in enumerate(rows):
        y = top + grp_h * i + 4
        p.append(f'<g class="hit" {tipattrs(r.get("tipv", fmt(r["a"]) + " vs " + fmt(r["b"])), r["tip"])}>')
        p.append(f'<rect class="hitbox" x="0" y="{y-4}" width="{width}" height="{grp_h}"/>')
        p.append(f'<text class="lab" x="{label_w-12}" y="{y+13}" text-anchor="end">{esc(r["label"])}</text>')
        for j, (val, cls) in enumerate([(r["a"], a_cls), (r["b"], b_cls)]):
            w = X(val) - label_w
            yy = y + j * 11
            if w > 0.5:
                rx = min(3, w / 2)
                p.append(f'<path class="{cls}" d="M{label_w},{yy} h{w-rx:.1f} a{rx},{rx} 0 0 1 {rx},{rx} v{9-2*rx:.1f} a{rx},{rx} 0 0 1 -{rx},{rx} h-{w-rx:.1f} z"/>')
        p.append(f'<text class="val" x="{label_w+plot_w+12}" y="{y+13}"><tspan class="strong">{esc(fmt(r["a"]))}</tspan><tspan class="soft"> vs {esc(fmt(r["b"]))}</tspan></text>')
        p.append('</g>')
    p.append(f'<line class="baseline" x1="{label_w}" x2="{label_w}" y1="{top}" y2="{h-22}"/>')
    p.append('</svg>')
    return "".join(p)

def hbar(rows, vmax, fmt, width=720, label_w=120, aria="", cls="bar-me"):
    plot_w = width - label_w - 70
    X = lambda v: label_w + v / vmax * plot_w
    rh = 26; top = 4; h = top + rh * len(rows) + 4
    p = [f'<svg class="chart" viewBox="0 0 {width} {h}" role="img" aria-label="{esc(aria)}">']
    for i, r in enumerate(rows):
        cy = top + rh * i + rh / 2
        w = X(r["value"]) - label_w
        p.append(f'<g class="hit" {tipattrs(fmt(r["value"]), r["tip"])}>')
        p.append(f'<rect class="hitbox" x="0" y="{cy-rh/2:.1f}" width="{width}" height="{rh}"/>')
        p.append(f'<text class="lab" x="{label_w-12}" y="{cy+4:.1f}" text-anchor="end">{esc(r["label"])}</text>')
        if w > 0.5:
            rx = min(3, w / 2)
            p.append(f'<path class="{cls}" d="M{label_w},{cy-6:.1f} h{w-rx:.1f} a{rx},{rx} 0 0 1 {rx},{rx} v{12-2*rx:.1f} a{rx},{rx} 0 0 1 -{rx},{rx} h-{w-rx:.1f} z"/>')
        p.append(f'<text class="val strong" x="{label_w+w+8:.1f}" y="{cy+4:.1f}">{esc(fmt(r["value"]))}</text>')
        p.append('</g>')
    p.append(f'<line class="baseline" x1="{label_w}" x2="{label_w}" y1="{top}" y2="{h-4}"/>')
    p.append('</svg>')
    return "".join(p)

def dumbbell(rows, lo, hi, fmt, width=720, label_w=200, val_w=130, aria="", a_lab="", b_lab=""):
    """rows dict(label, a (baseline/grey), b (Brett/accent), tip)."""
    plot_w = width - label_w - val_w - 12
    X = lambda v: label_w + (min(max(v, lo), hi) - lo) / (hi - lo) * plot_w
    rh = 28; top = 8; h = top + rh * len(rows) + 26
    p = [f'<svg class="chart" viewBox="0 0 {width} {h}" role="img" aria-label="{esc(aria)}">']
    for t in ticks(lo, hi):
        x = X(t); p.append(f'<line class="grid" x1="{x:.1f}" x2="{x:.1f}" y1="{top-4}" y2="{h-22}"/>')
        p.append(f'<text class="axis" x="{x:.1f}" y="{h-6}" text-anchor="middle">{esc(fmt(t))}</text>')
    for i, r in enumerate(rows):
        cy = top + rh * i + rh / 2
        p.append(f'<g class="hit" {tipattrs(fmt(r["b"]) + " vs " + fmt(r["a"]), r["tip"])}>')
        p.append(f'<rect class="hitbox" x="0" y="{cy-rh/2:.1f}" width="{width}" height="{rh}"/>')
        p.append(f'<text class="lab" x="{label_w-12}" y="{cy+4:.1f}" text-anchor="end">{esc(r["label"])}</text>')
        p.append(f'<line class="connector" x1="{X(r["a"]):.1f}" x2="{X(r["b"]):.1f}" y1="{cy:.1f}" y2="{cy:.1f}"/>')
        p.append(f'<circle class="dot-base" cx="{X(r["a"]):.1f}" cy="{cy:.1f}" r="5"/>')
        p.append(f'<circle class="dot-me" cx="{X(r["b"]):.1f}" cy="{cy:.1f}" r="5.5"/>')
        p.append(f'<text class="val" x="{label_w+plot_w+14}" y="{cy+4:.1f}"><tspan class="strong">{esc(fmt(r["b"]))}</tspan><tspan class="soft"> vs {esc(fmt(r["a"]))}</tspan></text>')
        p.append('</g>')
    p.append('</svg>')
    return "".join(p)

def heat(labels, M, width=560, cell=64, aria=""):
    n = len(labels); lw = 120; top = 70
    vmax = max(M[i][j] for i in range(n) for j in range(n) if i != j) or 1
    h = top + cell * n + 6
    p = [f'<svg class="chart heat" viewBox="0 0 {lw + cell*n + 6} {h}" role="img" aria-label="{esc(aria)}">']
    for j, l in enumerate(labels):
        x = lw + cell * j + cell / 2
        p.append(f'<text class="lab" x="{x:.1f}" y="{top-10}" text-anchor="start" transform="rotate(-35 {x:.1f} {top-10})">{esc(l)}</text>')
    for i, li in enumerate(labels):
        y = top + cell * i
        p.append(f'<text class="lab" x="{lw-10}" y="{y+cell/2+4:.1f}" text-anchor="end">{esc(li)}</text>')
        for j, lj in enumerate(labels):
            x = lw + cell * j
            if i == j:
                p.append(f'<rect class="cell-diag" x="{x+1}" y="{y+1}" width="{cell-2}" height="{cell-2}" rx="4"/>')
                continue
            v = M[i][j]; op = 0.10 + 0.9 * v / vmax
            txt = "cell-txt-dark" if op < 0.55 else "cell-txt-light"
            p.append(f'<g class="hit" {tipattrs(f"{v} shared", f"{li} & {lj}")}><rect class="cell" x="{x+1}" y="{y+1}" width="{cell-2}" height="{cell-2}" rx="4" fill-opacity="{op:.2f}"/>'
                     f'<text class="{txt}" x="{x+cell/2:.1f}" y="{y+cell/2+5:.1f}" text-anchor="middle">{v}</text></g>')
    p.append('</svg>')
    return "".join(p)

def table(headers, rows, cls="", num_cols=()):
    out = [f'<div class="tablewrap"><table class="{cls}"><thead><tr>']
    for i, hd in enumerate(headers):
        out.append(f'<th class="{"num" if i in num_cols else ""}">{esc(hd)}</th>')
    out.append('</tr></thead><tbody>')
    for r in rows:
        out.append('<tr>' + "".join(f'<td class="{"num" if i in num_cols else ""}">{c}</td>' for i, c in enumerate(r)) + '</tr>')
    out.append('</tbody></table></div>')
    return "".join(out)

def datatable(headers, rows, num_cols=(), summary="Chart data"):
    return f'<details class="data"><summary>{esc(summary)}</summary>{table(headers, [[esc(c) for c in r] for r in rows], "compact", num_cols)}</details>'

def lines(grid, series, width=720, height=300, xmax=None, fmt_y=lambda v: f"{v*100:.0f}%", fmt_x=lambda v: f"{v:.0f}", aria="", xlabel=""):
    """series: list of dict(label, values, cls). Step-style survival lines on one axis (0-100%)."""
    lpad, rpad, tpad, bpad = 48, 150, 10, 40
    xmax = xmax or max(grid)
    X = lambda v: lpad + v / xmax * (width - lpad - rpad)
    Y = lambda v: tpad + (1 - v) * (height - tpad - bpad)
    p = [f'<svg class="chart" viewBox="0 0 {width} {height}" role="img" aria-label="{esc(aria)}">']
    for t in [0, 0.25, 0.5, 0.75, 1.0]:
        p.append(f'<line class="grid" x1="{lpad}" x2="{width-rpad}" y1="{Y(t):.1f}" y2="{Y(t):.1f}"/><text class="axis" x="{lpad-8}" y="{Y(t)+4:.1f}" text-anchor="end">{esc(fmt_y(t))}</text>')
    for t in ticks(0, xmax, 6):
        p.append(f'<text class="axis" x="{X(t):.1f}" y="{height-bpad+16}" text-anchor="middle">{esc(fmt_x(t))}</text>')
    p.append(f'<text class="axis" x="{(lpad+width-rpad)/2:.1f}" y="{height-6}" text-anchor="middle">{esc(xlabel)}</text>')
    p.append(f'<line class="baseline" x1="{lpad}" x2="{width-rpad}" y1="{Y(0):.1f}" y2="{Y(0):.1f}"/>')
    for s in series:
        pts = []
        for i, (g, v) in enumerate(zip(grid, s["values"])):
            if i: pts.append(f"L{X(g):.1f},{Y(s['values'][i-1]):.1f}")
            pts.append(f"{'M' if not i else 'L'}{X(g):.1f},{Y(v):.1f}")
        p.append(f'<path class="line {s["cls"]}" d="{" ".join(pts)}" fill="none"/>')
        g, v = grid[-1], s["values"][-1]
        p.append(f'<circle class="dot-{ "me" if s["cls"]=="line-me" else "base"}" cx="{X(g):.1f}" cy="{Y(v):.1f}" r="4.5"/>')
        p.append(f'<text class="val" x="{X(g)+10:.1f}" y="{Y(v)+4:.1f}"><tspan class="strong">{esc(fmt_y(v))}</tspan><tspan class="soft"> {esc(s["label"])}</tspan></text>')
    # hover columns
    for i, g in enumerate(grid):
        x0 = X(grid[i - 1]) if i else X(0); x1 = X(g)
        x_mid0 = (x0 + x1) / 2 if i else X(0)
        x_mid1 = (X(g) + X(grid[i + 1])) / 2 if i + 1 < len(grid) else X(g) + 6
        lab = " · ".join(f"{s['label']} {fmt_y(s['values'][i])}" for s in series)
        p.append(f'<g class="hit" {tipattrs(f"Day {fmt_x(g)}", lab)}><rect class="hitbox" x="{x_mid0:.1f}" y="{tpad}" width="{max(x_mid1-x_mid0,4):.1f}" height="{height-tpad-bpad}"/></g>')
    p.append('</svg>')
    return "".join(p)

def trend_lines(xlabels, series, fmt, width=440, height=230, aria="", ymin=None, ymax=None):
    """Season-by-season lines on a categorical x axis, sized for a two-column grid of small multiples.
    series: list of dict(label, values (None = no data), cls in {'line-me','line-base'})."""
    lpad, rpad, tpad, bpad = 46, 84, 12, 30
    vals = [v for s in series for v in s["values"] if v is not None]
    lo = min(vals) if ymin is None else ymin; hi = max(vals) if ymax is None else ymax
    if hi == lo: hi = lo + 1
    pad = (hi - lo) * 0.08; lo_, hi_ = (lo - pad if ymin is None else lo), hi + pad
    n = len(xlabels)
    X = lambda i: lpad + (i + 0.5) / n * (width - lpad - rpad)
    Y = lambda v: tpad + (1 - (v - lo_) / (hi_ - lo_)) * (height - tpad - bpad)
    p = [f'<svg class="chart small" viewBox="0 0 {width} {height}" role="img" aria-label="{esc(aria)}">']
    for tv in ticks(lo_, hi_, 4):
        if lo_ <= tv <= hi_:
            p.append(f'<line class="grid" x1="{lpad}" x2="{width-rpad}" y1="{Y(tv):.1f}" y2="{Y(tv):.1f}"/><text class="axis" x="{lpad-8}" y="{Y(tv)+4:.1f}" text-anchor="end">{esc(fmt(tv))}</text>')
    for i, xl in enumerate(xlabels):
        p.append(f'<text class="axis" x="{X(i):.1f}" y="{height-bpad+18}" text-anchor="middle">{esc(xl)}</text>')
    for s in series:
        pts = [(X(i), Y(v)) for i, v in enumerate(s["values"]) if v is not None]
        if len(pts) > 1:
            p.append(f'<path class="line {s["cls"]}" fill="none" d="' + " ".join(f"{'M' if j == 0 else 'L'}{x:.1f},{y:.1f}" for j, (x, y) in enumerate(pts)) + '"/>')
        dot = "dot-me" if s["cls"] == "line-me" else "dot-base"
        for x, y in pts: p.append(f'<circle class="{dot}" cx="{x:.1f}" cy="{y:.1f}" r="4"/>')
        last = [(i, v) for i, v in enumerate(s["values"]) if v is not None]
        if last:
            i, v = last[-1]
            p.append(f'<text class="val" x="{X(i)+10:.1f}" y="{Y(v)+4:.1f}"><tspan class="strong">{esc(fmt(v))}</tspan><tspan class="soft"> {esc(s["label"])}</tspan></text>')
    for i, xl in enumerate(xlabels):
        x0 = lpad + i / n * (width - lpad - rpad); w = (width - lpad - rpad) / n
        lab = " · ".join(f"{s['label']} {fmt(s['values'][i]) if s['values'][i] is not None else '—'}" for s in series)
        p.append(f'<g class="hit" {tipattrs(xl, lab)}><rect class="hitbox" x="{x0:.1f}" y="{tpad}" width="{w:.1f}" height="{height-tpad-bpad}"/></g>')
    p.append('</svg>')
    return "".join(p)

def timeband(dates, me, fmt, lo=None, hi=None, med=None, marks=(), width=720, height=260, aria="", invert=False, ymin=None, ymax=None, me_label="", step=False):
    """A monthly time series: the league's range as a band (lo-hi), its median as a grey line, one team's line in the accent colour.
    dates: list of 'YYYY-MM-DD'; marks: [(date, label)] drawn as dashed verticals; invert puts the smallest value at the top (ranks)."""
    import datetime as _dt
    ds = [_dt.date.fromisoformat(str(d)[:10]) for d in dates]
    t0, t1 = ds[0].toordinal(), ds[-1].toordinal()
    lpad, rpad, tpad, bpad = 52, 130, 14, 30
    X = lambda d: lpad + (d.toordinal() - t0) / max(1, t1 - t0) * (width - lpad - rpad)
    vals = [v for s in (me, lo or [], hi or [], med or []) for v in s if v is not None]
    y0 = min(vals) if ymin is None else ymin; y1 = max(vals) if ymax is None else ymax
    if not invert and ymin is None: y0 = min(0, y0)
    if y1 == y0: y1 = y0 + 1
    Y = (lambda v: tpad + (v - y0) / (y1 - y0) * (height - tpad - bpad)) if invert else (lambda v: tpad + (1 - (v - y0) / (y1 - y0)) * (height - tpad - bpad))
    p = [f'<svg class="chart" viewBox="0 0 {width} {height}" role="img" aria-label="{esc(aria)}">']
    for tv in (ticks(y0, y1, 4) if not invert else [v for v in [1, 3, 6, 9, 12] if y0 <= v <= y1]):
        p.append(f'<line class="grid" x1="{lpad}" x2="{width-rpad}" y1="{Y(tv):.1f}" y2="{Y(tv):.1f}"/><text class="axis" x="{lpad-8}" y="{Y(tv)+4:.1f}" text-anchor="end">{esc(fmt(tv))}</text>')
    for yr in range(ds[0].year + 1, ds[-1].year + 1):
        x = X(_dt.date(yr, 1, 1))
        p.append(f'<line class="grid" x1="{x:.1f}" x2="{x:.1f}" y1="{tpad}" y2="{height-bpad}"/><text class="axis" x="{x:.1f}" y="{height-bpad+18}" text-anchor="middle">{yr}</text>')
    if lo and hi:
        up = " ".join(f"{'M' if i == 0 else 'L'}{X(d):.1f},{Y(v):.1f}" for i, (d, v) in enumerate(zip(ds, hi)))
        dn = " ".join(f"L{X(d):.1f},{Y(v):.1f}" for d, v in reversed(list(zip(ds, lo))))
        p.append(f'<path class="band" d="{up} {dn} Z"/>')
    def path(vs):
        pts = [(X(d), Y(v)) for d, v in zip(ds, vs) if v is not None]
        if step:
            out = [f"M{pts[0][0]:.1f},{pts[0][1]:.1f}"]
            for (xa, ya), (xb, yb) in zip(pts, pts[1:]): out += [f"L{xb:.1f},{ya:.1f}", f"L{xb:.1f},{yb:.1f}"]
            return " ".join(out)
        return " ".join(f"{'M' if i == 0 else 'L'}{x:.1f},{y:.1f}" for i, (x, y) in enumerate(pts))
    if med: p.append(f'<path class="line line-base" fill="none" stroke-dasharray="4 3" d="{path(med)}"/>')
    p.append(f'<path class="line line-me" fill="none" d="{path(me)}"/>')
    for d, lab in marks:
        x = X(_dt.date.fromisoformat(str(d)[:10]))
        p.append(f'<line class="baseline" stroke-dasharray="3 3" x1="{x:.1f}" x2="{x:.1f}" y1="{tpad}" y2="{height-bpad}"/><text class="axis" x="{x+4:.1f}" y="{tpad+10}">{esc(lab)}</text>')
    xe, ye = X(ds[-1]), Y(me[-1])
    p.append(f'<circle class="dot-me" cx="{xe:.1f}" cy="{ye:.1f}" r="4.5"/><text class="val" x="{xe+10:.1f}" y="{ye+4:.1f}"><tspan class="strong">{esc(fmt(me[-1]))}</tspan><tspan class="soft"> {esc(me_label)}</tspan></text>')
    n = len(ds)
    for i, d in enumerate(ds):
        xa = (X(ds[i - 1]) + X(d)) / 2 if i else lpad; xb = (X(d) + X(ds[i + 1])) / 2 if i + 1 < n else width - rpad
        lab = f"{me_label} {fmt(me[i])}" + (f" · league median {fmt(med[i])}" if med else "") + (f" · range {fmt(lo[i])}–{fmt(hi[i])}" if lo and hi else "")
        p.append(f'<g class="hit" {tipattrs(d.strftime("%b %Y"), lab)}><rect class="hitbox" x="{xa:.1f}" y="{tpad}" width="{max(xb-xa,2):.1f}" height="{height-tpad-bpad}"/></g>')
    p.append('</svg>')
    return "".join(p)

def waterfall(steps, fmt, width=720, label_w=230, aria=""):
    """Horizontal waterfall. steps: dict(label, value, total (bool), tip). Totals run from zero; changes run from the running total."""
    run, spans = 0.0, []
    for s in steps:
        if s.get("total"): a, b = 0.0, s["value"]; run = s["value"]
        else: a, b = run, run + s["value"]; run = b
        spans.append((a, b))
    lo = min(0.0, min(min(a, b) for a, b in spans)); hi = max(max(a, b) for a, b in spans)
    plot_w = width - label_w - 90
    X = lambda v: label_w + (v - lo) / (hi - lo) * plot_w
    rh = 30; top = 6; h = top + rh * len(steps) + 26
    p = [f'<svg class="chart" viewBox="0 0 {width} {h}" role="img" aria-label="{esc(aria)}">']
    for tv in ticks(lo, hi, 5):
        x = X(tv); p.append(f'<line class="grid" x1="{x:.1f}" x2="{x:.1f}" y1="{top}" y2="{h-22}"/><text class="axis" x="{x:.1f}" y="{h-6}" text-anchor="middle">{esc(fmt(tv))}</text>')
    for i, (s, (a, b)) in enumerate(zip(steps, spans)):
        cy = top + rh * i + rh / 2
        cls = "bar-base" if s.get("total") else ("bar-over" if s["value"] >= 0 else "bar-under")
        xa, xb = sorted([X(a), X(b)]); w = max(xb - xa, 1.5)
        p.append(f'<g class="hit" {tipattrs(fmt(s["value"]), s.get("tip", s["label"]))}><rect class="hitbox" x="0" y="{cy-rh/2:.1f}" width="{width}" height="{rh}"/>')
        p.append(f'<text class="lab" x="{label_w-12}" y="{cy+4:.1f}" text-anchor="end">{esc(s["label"])}</text>')
        p.append(f'<rect class="{cls}" x="{xa:.1f}" y="{cy-8:.1f}" width="{w:.1f}" height="16" rx="3"/>')
        shown = fmt(s["value"]) if s.get("total") else (("+" if s["value"] >= 0 else "") + fmt(s["value"]))
        p.append(f'<text class="val strong" x="{xb+8:.1f}" y="{cy+4:.1f}">{esc(shown)}</text></g>')
        if i + 1 < len(steps):
            nx = X(b); p.append(f'<line class="connector" x1="{nx:.1f}" x2="{nx:.1f}" y1="{cy+8:.1f}" y2="{cy+rh-8:.1f}"/>')
    p.append(f'<line class="baseline" x1="{X(0):.1f}" x2="{X(0):.1f}" y1="{top}" y2="{h-22}"/>')
    p.append('</svg>')
    return "".join(p)
