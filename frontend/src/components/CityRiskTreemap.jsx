import { useRef, useEffect, useState, useCallback, memo } from 'react';
import * as d3 from 'd3';

const RISK_COLORS = {
  critical: { bg: '#ef4444', glow: 'rgba(239,68,68,0.45)', accent: '#fca5a5' },
  high:     { bg: '#f97316', glow: 'rgba(249,115,22,0.38)', accent: '#fdba74' },
  moderate: { bg: '#eab308', glow: 'rgba(234,179,8,0.30)', accent: '#fde047' },
  low:      { bg: '#22c55e', glow: 'rgba(34,197,94,0.30)', accent: '#86efac' },
};

function riskBand(score) {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 40) return 'moderate';
  return 'low';
}

function CityRiskTreemap({ data = [], height = 560 }) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const tooltipRef = useRef(null);
  const prevFpRef = useRef('');
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setWidth(prev => (prev === w ? prev : w));
    });
    ro.observe(el);
    const rect = el.getBoundingClientRect();
    if (rect.width > 0) setWidth(Math.round(rect.width));
    return () => ro.disconnect();
  }, [data.length > 0]);

  const buildChart = useCallback(() => {
    const svgEl = svgRef.current;
    if (!data.length || width === 0 || !svgEl) return;

    // Aggregate by city
    const cityMap = new Map();
    for (const d of data) {
      const city = d.city || 'Unknown';
      if (!cityMap.has(city)) cityMap.set(city, { scores: [], roles: [] });
      const entry = cityMap.get(city);
      const score = Number(d.score) || 0;
      entry.scores.push(score);
      entry.roles.push({ role: d.canonicalRole || d.canonical_role || d.role || 'â€”', score, band: d.riskBand || riskBand(score) });
    }
    const cities = [...cityMap.entries()].map(([city, { scores, roles }]) => ({
      city,
      score: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
      maxScore: Math.max(...scores),
      roles: roles.sort((a, b) => b.score - a.score),
      roleCount: roles.length,
    })).sort((a, b) => b.score - a.score);

    const fp = cities.map(c => `${c.city}:${c.score}:${c.roleCount}`).join('|');
    if (fp === prevFpRef.current) return;
    prevFpRef.current = fp;

    const svg = d3.select(svgEl);
    const tooltip = d3.select(tooltipRef.current);
    const W = width;
    const H = height;

    svg.selectAll('*').remove();
    svg.attr('width', W).attr('height', H)
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('preserveAspectRatio', 'xMidYMid meet');

    // Hierarchy
    const root = d3.hierarchy({ children: cities })
      .sum(d => Math.max(d.score || 0, 5))
      .sort((a, b) => b.value - a.value);

    d3.treemap()
      .size([W, H])
      .paddingOuter(5)
      .paddingInner(4)
      .round(true)(root);

    /* ---- Defs ---- */
    const defs = svg.append('defs');

    // Subtle drop shadow
    const shadow = defs.append('filter').attr('id', 'tm-shadow')
      .attr('x', '-20%').attr('y', '-20%').attr('width', '140%').attr('height', '140%');
    shadow.append('feDropShadow').attr('dx', 0).attr('dy', 3).attr('stdDeviation', 5)
      .attr('flood-color', '#000').attr('flood-opacity', 0.5);

    // Hover glow
    const glow = defs.append('filter').attr('id', 'tm-glow')
      .attr('x', '-30%').attr('y', '-30%').attr('width', '160%').attr('height', '160%');
    glow.append('feGaussianBlur').attr('stdDeviation', 10).attr('result', 'blur');
    const merge = glow.append('feMerge');
    merge.append('feMergeNode').attr('in', 'blur');
    merge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Critical pulse glow
    const pulse = defs.append('filter').attr('id', 'tm-pulse')
      .attr('x', '-30%').attr('y', '-30%').attr('width', '160%').attr('height', '160%');
    pulse.append('feGaussianBlur').attr('stdDeviation', 6).attr('result', 'blur');
    const pm = pulse.append('feMerge');
    pm.append('feMergeNode').attr('in', 'blur');
    pm.append('feMergeNode').attr('in', 'SourceGraphic');

    // Diagonal shine gradient
    const shine = defs.append('linearGradient')
      .attr('id', 'tm-shine').attr('x1', '0%').attr('y1', '0%').attr('x2', '100%').attr('y2', '100%');
    shine.append('stop').attr('offset', '0%').attr('stop-color', '#fff').attr('stop-opacity', 0.18);
    shine.append('stop').attr('offset', '35%').attr('stop-color', '#fff').attr('stop-opacity', 0.04);
    shine.append('stop').attr('offset', '100%').attr('stop-color', '#fff').attr('stop-opacity', 0);

    // Noise texture pattern
    const noisePattern = defs.append('pattern')
      .attr('id', 'tm-noise').attr('width', 100).attr('height', 100)
      .attr('patternUnits', 'userSpaceOnUse');
    noisePattern.append('rect').attr('width', 100).attr('height', 100).attr('fill', 'transparent');
    // Subtle speckles
    for (let i = 0; i < 50; i++) {
      noisePattern.append('circle')
        .attr('cx', Math.random() * 100).attr('cy', Math.random() * 100)
        .attr('r', Math.random() * 0.8 + 0.2)
        .attr('fill', '#fff').attr('opacity', Math.random() * 0.06);
    }

    // Per-city gradients
    const indexMap = new Map();
    cities.forEach((c, i) => {
      indexMap.set(c.city, i);
      const band = riskBand(c.score);
      const col = d3.color(RISK_COLORS[band].bg);
      const lighter = col.copy(); lighter.opacity = 0.92;
      const darker = col.darker(1.4);

      const grad = defs.append('linearGradient')
        .attr('id', `tm-grad-${i}`)
        .attr('x1', '0%').attr('y1', '0%').attr('x2', '100%').attr('y2', '100%');
      grad.append('stop').attr('offset', '0%').attr('stop-color', lighter).attr('stop-opacity', 0.9);
      grad.append('stop').attr('offset', '100%').attr('stop-color', darker).attr('stop-opacity', 0.95);

      // Radial glow per city (inner glow effect)
      const rg = defs.append('radialGradient')
        .attr('id', `tm-inner-${i}`)
        .attr('cx', '30%').attr('cy', '25%').attr('r', '80%');
      rg.append('stop').attr('offset', '0%').attr('stop-color', '#fff').attr('stop-opacity', 0.12);
      rg.append('stop').attr('offset', '100%').attr('stop-color', '#fff').attr('stop-opacity', 0);
    });

    // Animate pulse for critical/high
    const styleEl = document.createElement('style');
    styleEl.textContent = `
      @keyframes tm-pulse-anim { 0%,100%{filter:url(#tm-shadow)} 50%{filter:url(#tm-pulse)} }
      .tm-cell--critical .tm-rect { animation: tm-pulse-anim 2.5s ease-in-out infinite; }
    `;
    document.head.appendChild(styleEl);
    // Clean up on next rebuild
    const cleanStyle = () => styleEl.remove();

    const leaves = root.leaves();

    // Cell groups with staggered entrance
    const cellGroups = svg.selectAll('.tm-cell')
      .data(leaves, d => d.data.city)
      .enter()
      .append('g')
      .attr('class', d => `tm-cell ${riskBand(d.data.score) === 'critical' ? 'tm-cell--critical' : ''}`)
      .attr('transform', d => `translate(${d.x0},${d.y0})`)
      .attr('opacity', 0);

    // Staggered fade-in
    cellGroups.transition().duration(500)
      .delay((_, i) => i * 30)
      .attr('opacity', 1);

    // Main fill rect
    cellGroups.append('rect').attr('class', 'tm-rect')
      .attr('rx', 10).attr('ry', 10)
      .attr('filter', 'url(#tm-shadow)')
      .attr('width', d => d.x1 - d.x0)
      .attr('height', d => d.y1 - d.y0)
      .attr('fill', d => `url(#tm-grad-${indexMap.get(d.data.city) ?? 0})`);

    // Inner glow overlay
    cellGroups.append('rect').attr('class', 'tm-inner')
      .attr('rx', 10).attr('ry', 10)
      .attr('pointer-events', 'none')
      .attr('width', d => d.x1 - d.x0)
      .attr('height', d => d.y1 - d.y0)
      .attr('fill', d => `url(#tm-inner-${indexMap.get(d.data.city) ?? 0})`);

    // Diagonal shine highlight
    cellGroups.append('rect').attr('class', 'tm-shine')
      .attr('rx', 10).attr('ry', 10)
      .attr('fill', 'url(#tm-shine)')
      .attr('pointer-events', 'none')
      .attr('width', d => d.x1 - d.x0)
      .attr('height', d => d.y1 - d.y0);

    // Subtle noise texture
    cellGroups.append('rect')
      .attr('rx', 10).attr('ry', 10)
      .attr('fill', 'url(#tm-noise)')
      .attr('pointer-events', 'none')
      .attr('width', d => d.x1 - d.x0)
      .attr('height', d => d.y1 - d.y0);

    // Border with glow color
    cellGroups.append('rect').attr('class', 'tm-border')
      .attr('rx', 10).attr('ry', 10)
      .attr('fill', 'none').attr('stroke-width', 1.5)
      .attr('width', d => d.x1 - d.x0)
      .attr('height', d => d.y1 - d.y0)
      .attr('stroke', d => {
        const col = RISK_COLORS[riskBand(d.data.score)].accent;
        return d3.color(col).copy({ opacity: 0.5 });
      });

    // Score badge (top-right pill)
    cellGroups.each(function (d) {
      const w = d.x1 - d.x0, h = d.y1 - d.y0;
      if (w < 55 || h < 45) return;
      const g = d3.select(this);
      const band = riskBand(d.data.score);
      const pillW = d.data.score >= 10 ? 36 : 28;
      const pillH = 20;
      const px = w - pillW - 8;
      const py = 8;

      g.append('rect')
        .attr('x', px).attr('y', py)
        .attr('width', pillW).attr('height', pillH)
        .attr('rx', 10).attr('ry', 10)
        .attr('fill', 'rgba(0,0,0,0.35)');
      g.append('text')
        .attr('x', px + pillW / 2).attr('y', py + pillH / 2 + 1)
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
        .attr('fill', RISK_COLORS[band].accent)
        .attr('font-size', '11px').attr('font-weight', 800)
        .attr('pointer-events', 'none')
        .text(d.data.score);
    });

    // City name
    cellGroups.append('text').attr('class', 'tm-city')
      .attr('fill', '#fff').attr('font-weight', 700).attr('pointer-events', 'none')
      .attr('text-anchor', 'start').attr('dominant-baseline', 'hanging')
      .each(function (d) {
        const w = d.x1 - d.x0, h = d.y1 - d.y0;
        const isTiny = w < 50 || h < 40;
        const isSmall = w < 80 || h < 55;
        const fontSize = Math.max(9, Math.min(17, w * 0.11));
        d3.select(this)
          .attr('x', 10)
          .attr('y', 10)
          .attr('font-size', `${fontSize}px`)
          .text(isTiny ? d.data.city.slice(0, 3) : isSmall ? d.data.city.slice(0, 8) : d.data.city);
      });

    // Risk band pill (below city name)
    cellGroups.each(function (d) {
      const w = d.x1 - d.x0, h = d.y1 - d.y0;
      if (w < 80 || h < 60) return;
      const g = d3.select(this);
      const band = riskBand(d.data.score);
      const label = band.toUpperCase();
      const bandW = label.length * 7 + 12;
      const bandH = 16;
      const bx = 10, by = 30;

      g.append('rect')
        .attr('x', bx).attr('y', by)
        .attr('width', bandW).attr('height', bandH)
        .attr('rx', 8).attr('ry', 8)
        .attr('fill', RISK_COLORS[band].bg)
        .attr('opacity', 0.2);
      g.append('text')
        .attr('x', bx + bandW / 2).attr('y', by + bandH / 2 + 1)
        .attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
        .attr('fill', RISK_COLORS[band].accent)
        .attr('font-size', '8px').attr('font-weight', 700)
        .attr('letter-spacing', '1.2px').attr('pointer-events', 'none')
        .text(label);
    });

    // Role count (bottom-left)
    cellGroups.append('text').attr('class', 'tm-roles')
      .attr('fill', 'rgba(255,255,255,0.45)').attr('font-weight', 500).attr('pointer-events', 'none')
      .attr('text-anchor', 'start').attr('dominant-baseline', 'auto')
      .each(function (d) {
        const w = d.x1 - d.x0, h = d.y1 - d.y0;
        if (w < 70 || h < 55) { d3.select(this).remove(); return; }
        d3.select(this)
          .attr('x', 10).attr('y', h - 10)
          .attr('font-size', `${Math.max(8, Math.min(11, w * 0.07))}px`)
          .text(`${d.data.roleCount} role${d.data.roleCount !== 1 ? 's' : ''} tracked`);
      });

    // Sparkline indicator (bottom-right small bar)
    cellGroups.each(function (d) {
      const w = d.x1 - d.x0, h = d.y1 - d.y0;
      if (w < 100 || h < 70) return;
      const g = d3.select(this);
      const band = riskBand(d.data.score);
      const barMaxW = Math.min(50, w * 0.3);
      const barW = (d.data.score / 100) * barMaxW;
      const bx = w - barMaxW - 10;
      const by = h - 14;

      g.append('rect')
        .attr('x', bx).attr('y', by)
        .attr('width', barMaxW).attr('height', 5)
        .attr('rx', 2.5).attr('ry', 2.5)
        .attr('fill', 'rgba(255,255,255,0.08)');
      g.append('rect')
        .attr('x', bx).attr('y', by)
        .attr('width', 0).attr('height', 5)
        .attr('rx', 2.5).attr('ry', 2.5)
        .attr('fill', RISK_COLORS[band].accent)
        .attr('opacity', 0.7)
        .transition().duration(800).delay(300)
        .attr('width', barW);
    });

    /* ---- Interactions ---- */
    cellGroups
      .on('mouseenter', function (event, d) {
        const g = d3.select(this);
        const city = d.data;
        const band = riskBand(city.score);
        const col = RISK_COLORS[band];

        g.raise();
        g.select('.tm-rect')
          .transition().duration(200)
          .attr('filter', 'url(#tm-glow)');
        g.select('.tm-border')
          .transition().duration(200)
          .attr('stroke-width', 2.5)
          .attr('stroke', col.accent);

        cellGroups.filter(n => n !== d).transition().duration(200).attr('opacity', 0.3);
        g.transition().duration(200).attr('opacity', 1);

        // Tooltip
        const [mx, my] = d3.pointer(event, svgEl);
        const topRoles = city.roles.slice(0, 5).map(r => {
          const rb = riskBand(r.score);
          return `<div class="tm-tooltip__role">
            <span class="tm-tooltip__role-dot" style="background:${RISK_COLORS[rb].bg}"></span>
            <span class="tm-tooltip__role-name">${r.role}</span>
            <span style="color:${RISK_COLORS[rb].accent};font-weight:700">${r.score}</span>
          </div>`;
        }).join('');
        const moreCount = city.roles.length > 5 ? `<div class="tm-tooltip__more">+${city.roles.length - 5} more</div>` : '';

        tooltip.style('opacity', 1)
          .style('left', `${Math.min(mx + 18, W - 240)}px`)
          .style('top', `${Math.max(my - 10, 5)}px`)
          .html(`
            <div class="tm-tooltip__city">${city.city}</div>
            <div class="tm-tooltip__score">
              <span class="tm-tooltip__score-num" style="color:${col.accent}">${city.score}</span>
              <span class="tm-tooltip__band" style="background:${col.bg}22;color:${col.accent};border:1px solid ${col.bg}44">${band.toUpperCase()}</span>
            </div>
            <div class="tm-tooltip__meta">${city.roleCount} roles tracked Â· Peak score ${city.maxScore}</div>
            <div class="tm-tooltip__divider"></div>
            <div class="tm-tooltip__roles-title">Top Vulnerable Roles</div>
            ${topRoles}
            ${moreCount}
          `);
      })
      .on('mousemove', function (event) {
        const [mx, my] = d3.pointer(event, svgEl);
        tooltip
          .style('left', `${Math.min(mx + 18, W - 240)}px`)
          .style('top', `${Math.max(my - 10, 5)}px`);
      })
      .on('mouseleave', function () {
        d3.select(this).select('.tm-rect').transition().duration(300).attr('filter', 'url(#tm-shadow)');
        d3.select(this).select('.tm-border').transition().duration(300).attr('stroke-width', 1.5);
        cellGroups.transition().duration(300).attr('opacity', 1);
        tooltip.style('opacity', 0);
      });

    return cleanStyle;
  }, [data, width, height]);

  useEffect(() => {
    const cleanup = buildChart();
    return () => { if (cleanup) cleanup(); };
  }, [buildChart]);

  return (
    <div ref={containerRef} className="tm-container" style={{ width: '100%', position: 'relative', minHeight: data.length ? height : 'auto' }}>
      {!data.length ? (
        <p className="empty-state">No city risk data available yet.</p>
      ) : (
        <>
          <svg ref={svgRef} width={width || '100%'} height={height} style={{ display: 'block' }} />
          <div ref={tooltipRef} className="tm-tooltip" />
        </>
      )}
    </div>
  );
}

export default memo(CityRiskTreemap, (prev, next) => {
  if (prev.height !== next.height) return false;
  if (prev.data.length !== next.data.length) return false;
  if (prev.data.length === 0) return true;
  return prev.data.every((d, i) => d.city === next.data[i]?.city && d.score === next.data[i]?.score);
});
