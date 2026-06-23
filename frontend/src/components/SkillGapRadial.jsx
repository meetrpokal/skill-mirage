import { useRef, useEffect, useState, useCallback, memo } from 'react';
import * as d3 from 'd3';

const SEVERITY_COLORS = {
  high:     { bar: '#ef4444', glow: 'rgba(239,68,68,0.5)', text: '#fca5a5' },
  moderate: { bar: '#f97316', glow: 'rgba(249,115,22,0.4)', text: '#fdba74' },
  low:      { bar: '#eab308', glow: 'rgba(234,179,8,0.35)', text: '#fde047' },
};

function severity(gap) {
  if (gap > 50) return 'high';
  if (gap > 25) return 'moderate';
  return 'low';
}

function SkillGapRadial({ data = [], height = 520 }) {
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

    const fp = data.map(d => `${d.skill}:${d.gap}:${d.mentions}`).join('|');
    if (fp === prevFpRef.current) return;
    prevFpRef.current = fp;

    const svg = d3.select(svgEl);
    const tooltip = d3.select(tooltipRef.current);
    svg.selectAll('*').remove();

    const sorted = [...data]
      .sort((a, b) => (b.gap || b.mentions || 0) - (a.gap || a.mentions || 0))
      .slice(0, 20);

    const W = width;
    const H = height;
    const cx = W / 2;
    const cy = H / 2;
    const outerR = Math.min(W, H) / 2 - 40;
    const innerR = outerR * 0.3;

    svg.attr('viewBox', `0 0 ${W} ${H}`).attr('preserveAspectRatio', 'xMidYMid meet');

    // Defs — glow filter
    const defs = svg.append('defs');
    const glow = defs.append('filter')
      .attr('id', 'radial-glow')
      .attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
    glow.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur');
    const mg = glow.append('feMerge');
    mg.append('feMergeNode').attr('in', 'blur');
    mg.append('feMergeNode').attr('in', 'SourceGraphic');

    const glowHover = defs.append('filter')
      .attr('id', 'radial-glow-hover')
      .attr('x', '-60%').attr('y', '-60%').attr('width', '220%').attr('height', '220%');
    glowHover.append('feGaussianBlur').attr('stdDeviation', '6').attr('result', 'blur');
    const mg2 = glowHover.append('feMerge');
    mg2.append('feMergeNode').attr('in', 'blur');
    mg2.append('feMergeNode').attr('in', 'SourceGraphic');

    // Scales
    const maxGap = d3.max(sorted, d => d.gap || d.mentions || 0) || 1;
    const radiusScale = d3.scaleLinear()
      .domain([0, maxGap])
      .range([innerR, outerR]);

    const angleScale = d3.scaleBand()
      .domain(sorted.map(d => d.skill))
      .range([0, 2 * Math.PI])
      .padding(0.12);

    const g = svg.append('g').attr('transform', `translate(${cx},${cy})`);

    // Background rings
    const ringValues = [0.25, 0.5, 0.75, 1.0];
    g.selectAll('.bg-ring')
      .data(ringValues)
      .join('circle')
      .attr('r', d => innerR + (outerR - innerR) * d)
      .attr('fill', 'none')
      .attr('stroke', '#222235')
      .attr('stroke-width', 0.8)
      .attr('stroke-dasharray', '3,5')
      .attr('opacity', 0.5);

    // Center circle
    g.append('circle')
      .attr('r', innerR)
      .attr('fill', 'rgba(10,10,15,0.6)')
      .attr('stroke', '#222235')
      .attr('stroke-width', 1);

    // Center label
    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '-0.3em')
      .attr('fill', '#8888a0')
      .attr('font-size', '11px')
      .attr('font-family', 'inherit')
      .text('SKILL');
    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '1em')
      .attr('fill', '#8888a0')
      .attr('font-size', '11px')
      .attr('font-family', 'inherit')
      .text('GAPS');

    // Arc generator
    const arcGen = d3.arc()
      .innerRadius(innerR + 2)
      .cornerRadius(3);

    // Draw bars
    const bars = g.selectAll('.gap-arc')
      .data(sorted)
      .join('g')
      .attr('class', 'gap-arc');

    bars.append('path')
      .attr('d', d => {
        const gapVal = d.gap || d.mentions || 0;
        return arcGen({
          outerRadius: radiusScale(gapVal),
          startAngle: angleScale(d.skill),
          endAngle: angleScale(d.skill) + angleScale.bandwidth(),
        });
      })
      .attr('fill', d => SEVERITY_COLORS[severity(d.gap || d.mentions || 0)].bar)
      .attr('opacity', 0.85)
      .attr('filter', 'url(#radial-glow)')
      .style('cursor', 'pointer')
      .on('mouseenter', function (event, d) {
        d3.select(this)
          .transition().duration(150)
          .attr('opacity', 1)
          .attr('filter', 'url(#radial-glow-hover)');

        const gapVal = d.gap || d.mentions || 0;
        const sev = severity(gapVal);
        tooltip
          .style('opacity', 1)
          .html(`
            <div style="font-weight:700;font-size:13px;margin-bottom:4px;color:${SEVERITY_COLORS[sev].text}">${d.skill}</div>
            <div style="display:flex;gap:12px;font-size:11px">
              <span>Gap: <b>${gapVal}</b></span>
              <span>Mentions: <b>${d.mentions || 0}</b></span>
            </div>
            <div style="font-size:10px;margin-top:3px;color:${SEVERITY_COLORS[sev].text};text-transform:uppercase">${sev} severity</div>
          `);
      })
      .on('mousemove', (event) => {
        const [mx, my] = d3.pointer(event, svgEl);
        tooltip
          .style('left', `${mx + 14}px`)
          .style('top', `${my - 10}px`);
      })
      .on('mouseleave', function () {
        d3.select(this)
          .transition().duration(200)
          .attr('opacity', 0.85)
          .attr('filter', 'url(#radial-glow)');
        tooltip.style('opacity', 0);
      })
      // Entrance animation
      .attr('transform', 'scale(0)')
      .transition()
      .duration(600)
      .delay((_, i) => i * 40)
      .ease(d3.easeBackOut.overshoot(1.2))
      .attr('transform', 'scale(1)');

    // Outer labels
    const labelG = g.selectAll('.gap-label')
      .data(sorted)
      .join('g')
      .attr('class', 'gap-label');

    labelG.append('text')
      .attr('transform', d => {
        const angle = angleScale(d.skill) + angleScale.bandwidth() / 2;
        const labelR = outerR + 14;
        const deg = (angle * 180 / Math.PI) - 90;
        const flip = angle > Math.PI;
        return `rotate(${deg}) translate(${labelR},0) rotate(${flip ? 180 : 0})`;
      })
      .attr('text-anchor', d => {
        const angle = angleScale(d.skill) + angleScale.bandwidth() / 2;
        return angle > Math.PI ? 'end' : 'start';
      })
      .attr('dy', '0.35em')
      .attr('fill', d => SEVERITY_COLORS[severity(d.gap || d.mentions || 0)].text)
      .attr('font-size', '10px')
      .attr('font-weight', 500)
      .attr('font-family', 'inherit')
      .attr('opacity', 0)
      .text(d => d.skill.length > 16 ? d.skill.slice(0, 14) + '…' : d.skill)
      .transition()
      .duration(400)
      .delay((_, i) => 300 + i * 30)
      .attr('opacity', 1);

    // Value labels on bars (for top items)
    bars.filter((_, i) => i < 8)
      .append('text')
      .attr('transform', d => {
        const angle = angleScale(d.skill) + angleScale.bandwidth() / 2;
        const gapVal = d.gap || d.mentions || 0;
        const r = (innerR + radiusScale(gapVal)) / 2;
        const x = r * Math.sin(angle);
        const y = -r * Math.cos(angle);
        return `translate(${x},${y})`;
      })
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('fill', '#fff')
      .attr('font-size', '9px')
      .attr('font-weight', 700)
      .attr('font-family', 'inherit')
      .attr('pointer-events', 'none')
      .attr('opacity', 0)
      .text(d => d.gap || d.mentions || 0)
      .transition()
      .duration(400)
      .delay((_, i) => 500 + i * 40)
      .attr('opacity', 0.9);

  }, [data, width, height]);

  useEffect(() => { buildChart(); }, [buildChart]);

  return (
    <div ref={containerRef} style={{ width: '100%', position: 'relative' }}>
      <svg
        ref={svgRef}
        width={width || '100%'}
        height={height}
        style={{ display: 'block', overflow: 'visible' }}
      />
      <div
        ref={tooltipRef}
        style={{
          position: 'absolute',
          pointerEvents: 'none',
          background: 'rgba(16,16,26,0.95)',
          border: '1px solid #333',
          borderRadius: 10,
          padding: '8px 12px',
          color: '#f0f0f5',
          fontSize: 12,
          opacity: 0,
          transition: 'opacity 0.15s',
          zIndex: 20,
          backdropFilter: 'blur(8px)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}
      />
    </div>
  );
}

export default memo(SkillGapRadial);
