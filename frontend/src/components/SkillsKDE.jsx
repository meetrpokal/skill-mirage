import { useRef, useEffect, useState, useCallback, memo } from 'react';
import * as d3 from 'd3';

const COLORS = ['#ff3d5a', '#a855f7', '#06b6d4', '#22c55e', '#eab308', '#3b82f6', '#f97316', '#ec4899', '#14b8a6', '#f43f5e'];

/** Serialize data to a fingerprint string for shallow comparison */
function fingerprint(data) {
  return data.map(d => `${d.skill}:${d.mentions}`).join('|');
}

function SkillsKDE({ data = [], cooccurrence = [], height = 560 }) {
  const containerRef = useRef();
  const svgRef = useRef();
  const tooltipRef = useRef();
  const simRef = useRef(null);
  const nodesRef = useRef([]); // live node objects (mutated by d3-force)
  const prevFpRef = useRef(''); // previous data fingerprint
  const initRef = useRef(false); // whether initial draw happened
  const hoverRef = useRef(false); // true while pointer is over chart
  const [dimensions, setDimensions] = useState({ width: 0, height });

  // Responsive resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      if (w > 0) setDimensions(prev => prev.width === w ? prev : { width: w, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);

  // Build the chart once, then only update when data actually changes
  const buildChart = useCallback(() => {
    if (!data.length || dimensions.width === 0) return;

    const coFp = cooccurrence.map(c => `${c.source}:${c.target}:${c.weight}`).join('|');
    const fp = fingerprint(data.slice(0, 25)) + '||' + coFp;
    const isInit = !initRef.current;
    const dataChanged = fp !== prevFpRef.current;

    // Skip if nothing changed
    if (!isInit && !dataChanged) return;
    prevFpRef.current = fp;

    const svg = d3.select(svgRef.current);
    const tooltip = d3.select(tooltipRef.current);
    const W = dimensions.width;
    const H = dimensions.height;
    const cx = W / 2;
    const cy = H / 2;

    const sorted = [...data].sort((a, b) => b.mentions - a.mentions).slice(0, 25);
    const maxMentions = d3.max(sorted, d => d.mentions) || 1;
    const radiusScale = d3.scaleSqrt().domain([0, maxMentions]).range([18, Math.min(W, H) * 0.12]);
    const colorFn = (i) => COLORS[i % COLORS.length];

    // ── INITIAL DRAW ──
    if (isInit) {
      initRef.current = true;
      svg.selectAll('*').remove();
      svg.attr('viewBox', `0 0 ${W} ${H}`).attr('preserveAspectRatio', 'xMidYMid meet');

      const defs = svg.append('defs');

      // Glow filters
      const glow = defs.append('filter').attr('id', 'bubble-glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
      glow.append('feGaussianBlur').attr('stdDeviation', '6').attr('result', 'blur');
      const mg = glow.append('feMerge');
      mg.append('feMergeNode').attr('in', 'blur');
      mg.append('feMergeNode').attr('in', 'SourceGraphic');

      const glowH = defs.append('filter').attr('id', 'bubble-glow-hover').attr('x', '-80%').attr('y', '-80%').attr('width', '260%').attr('height', '260%');
      glowH.append('feGaussianBlur').attr('stdDeviation', '12').attr('result', 'blur');
      const mg2 = glowH.append('feMerge');
      mg2.append('feMergeNode').attr('in', 'blur');
      mg2.append('feMergeNode').attr('in', 'SourceGraphic');

      // Gradients container
      defs.append('g').attr('class', 'gradients');

      // Background ring
      svg.append('circle').attr('class', 'bg-ring')
        .attr('cx', cx).attr('cy', cy).attr('r', Math.min(W, H) * 0.45)
        .attr('fill', 'none').attr('stroke', '#222235').attr('stroke-width', 1)
        .attr('stroke-dasharray', '4,6').attr('opacity', 0.4);

      const container = svg.append('g').attr('class', 'main-container');
      container.append('g').attr('class', 'links');
      container.append('g').attr('class', 'bubbles');
    }

    // ── PREPARE NEW NODES (preserve positions from existing nodes if skill matches) ──
    const oldMap = new Map(nodesRef.current.map(n => [n.skill, n]));
    const nodes = sorted.map((d, i) => {
      const existing = oldMap.get(d.skill);
      return {
        skill: d.skill,
        mentions: d.mentions,
        index: i,
        r: radiusScale(d.mentions),
        color: colorFn(i),
        // Preserve position if node already existed — avoids jumps
        x: existing ? existing.x : cx + (Math.random() - 0.5) * 80,
        y: existing ? existing.y : cy + (Math.random() - 0.5) * 80,
        // Preserve velocity
        vx: existing ? existing.vx : 0,
        vy: existing ? existing.vy : 0,
      };
    });
    nodesRef.current = nodes;

    // ── UPDATE GRADIENTS ──
    const defs = svg.select('defs');
    const gradGroup = defs.select('.gradients');
    gradGroup.selectAll('radialGradient').remove();
    nodes.forEach((_, i) => {
      const c = colorFn(i);
      const grad = gradGroup.append('radialGradient').attr('id', `bg-${i}`).attr('cx', '35%').attr('cy', '35%');
      grad.append('stop').attr('offset', '0%').attr('stop-color', '#fff').attr('stop-opacity', 0.15);
      grad.append('stop').attr('offset', '50%').attr('stop-color', c).attr('stop-opacity', 0.85);
      grad.append('stop').attr('offset', '100%').attr('stop-color', d3.color(c).darker(1.5)).attr('stop-opacity', 0.95);
    });

    // ── UPDATE LINKS (from real co-occurrence data) ──
    const nodeMap = new Map(nodes.map(n => [n.skill.toLowerCase(), n]));
    const links = [];
    for (const pair of cooccurrence) {
      const src = nodeMap.get(pair.source?.toLowerCase());
      const tgt = nodeMap.get(pair.target?.toLowerCase());
      if (src && tgt) links.push({ source: src, target: tgt, weight: pair.weight || 1 });
    }
    const maxWeight = d3.max(links, l => l.weight) || 1;

    const linkGroup = svg.select('.links');
    const linkKey = l => `${l.source.skill}||${l.target.skill}`;
    const linkEls = linkGroup.selectAll('line').data(links, linkKey);
    linkEls.exit().transition().duration(300).attr('opacity', 0).remove();
    const linkEnter = linkEls.enter().append('line')
      .attr('stroke', '#334155').attr('stroke-width', l => 0.5 + (l.weight / maxWeight) * 2)
      .attr('opacity', 0).attr('stroke-dasharray', l => l.weight < maxWeight * 0.3 ? '3,4' : 'none');
    linkEnter.transition().duration(600).attr('opacity', l => 0.08 + (l.weight / maxWeight) * 0.25);
    const allLinks = linkEnter.merge(linkEls)
      .transition().duration(400)
      .attr('stroke-width', l => 0.5 + (l.weight / maxWeight) * 2)
      .attr('opacity', l => 0.08 + (l.weight / maxWeight) * 0.25)
      .selection();

    // ── DATA JOIN: bubbles ──
    const bubbleGroup = svg.select('.bubbles');
    const nodeGroups = bubbleGroup.selectAll('.bubble-node')
      .data(nodes, d => d.skill); // KEY by skill name

    // EXIT: removed skills
    nodeGroups.exit()
      .transition().duration(400).attr('opacity', 0)
      .select('.main-circle').attr('r', 0)
      .end().catch(() => {}).then(() => nodeGroups.exit().remove());

    // ENTER: new skills
    const enter = nodeGroups.enter().append('g')
      .attr('class', 'bubble-node').style('cursor', 'pointer').attr('opacity', 0);

    enter.append('circle').attr('class', 'glow-ring')
      .attr('r', d => d.r + 4).attr('fill', 'none')
      .attr('stroke', d => d.color).attr('stroke-width', 1.5)
      .attr('opacity', 0.3).attr('filter', 'url(#bubble-glow)');

    enter.append('circle').attr('class', 'main-circle')
      .attr('r', 0)
      .attr('fill', (d) => `url(#bg-${d.index})`)
      .attr('stroke', d => d.color).attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.6).attr('filter', 'url(#bubble-glow)');

    enter.append('text').attr('class', 'skill-label')
      .attr('text-anchor', 'middle')
      .attr('dy', d => d.r > 30 ? '-0.3em' : '0.35em')
      .attr('fill', '#fff')
      .attr('font-size', d => `${Math.max(8, Math.min(13, d.r * 0.35))}px`)
      .attr('font-weight', '700').attr('letter-spacing', '0.5px')
      .attr('pointer-events', 'none').attr('opacity', 0)
      .text(d => d.skill.length > 12 ? d.skill.slice(0, 11) + '…' : d.skill)
      .style('text-transform', 'capitalize');

    // Animate enter
    enter.transition().duration(500).attr('opacity', 1);
    enter.select('.main-circle').transition().duration(600).ease(d3.easeBackOut.overshoot(1.2)).attr('r', d => d.r);
    enter.select('.skill-label').transition().duration(400).delay(200).attr('opacity', 1);

    // Count label for new big bubbles
    enter.filter(d => d.r > 30).append('text').attr('class', 'count-label')
      .attr('text-anchor', 'middle').attr('dy', '1em')
      .attr('fill', '#ffffffaa')
      .attr('font-size', d => `${Math.max(7, d.r * 0.22)}px`)
      .attr('font-weight', '600').attr('pointer-events', 'none')
      .attr('opacity', 0).text(d => d.mentions.toLocaleString())
      .transition().duration(400).delay(200).attr('opacity', 1);

    // MERGE: all current groups
    const allGroups = enter.merge(nodeGroups);

    // UPDATE existing nodes: smoothly transition radius/color if changed
    allGroups.select('.main-circle')
      .transition().duration(500)
      .attr('r', d => d.r)
      .attr('fill', d => `url(#bg-${d.index})`)
      .attr('stroke', d => d.color);

    allGroups.select('.glow-ring')
      .transition().duration(500)
      .attr('r', d => d.r + 4)
      .attr('stroke', d => d.color);

    allGroups.select('.skill-label')
      .transition().duration(300)
      .attr('dy', d => d.r > 30 ? '-0.3em' : '0.35em')
      .attr('font-size', d => `${Math.max(8, Math.min(13, d.r * 0.35))}px`);

    allGroups.select('.count-label')
      .text(d => d.mentions.toLocaleString())
      .transition().duration(300)
      .attr('font-size', d => `${Math.max(7, d.r * 0.22)}px`);

    // Add count labels to nodes that grew past threshold
    allGroups.filter(d => d.r > 30).each(function (d) {
      if (!d3.select(this).select('.count-label').size() || d3.select(this).select('.count-label').empty()) {
        d3.select(this).append('text').attr('class', 'count-label')
          .attr('text-anchor', 'middle').attr('dy', '1em')
          .attr('fill', '#ffffffaa')
          .attr('font-size', `${Math.max(7, d.r * 0.22)}px`)
          .attr('font-weight', '600').attr('pointer-events', 'none')
          .attr('opacity', 0).text(d.mentions.toLocaleString())
          .transition().duration(300).attr('opacity', 1);
      }
    });

    // ── HOVER INTERACTIONS (re-bind on all groups) ──
    allGroups
      .on('mouseenter', function (event, d) {
        const sel = d3.select(this);
        sel.select('.main-circle')
          .transition().duration(200).attr('r', d.r * 1.15).attr('stroke-width', 2.5).attr('stroke-opacity', 1)
          .attr('filter', 'url(#bubble-glow-hover)');
        sel.select('.glow-ring')
          .transition().duration(200).attr('r', d.r * 1.15 + 6).attr('opacity', 0.6).attr('stroke-width', 2);
        sel.select('.skill-label').transition().duration(200).attr('font-size', `${Math.max(10, d.r * 0.4)}px`);
        // Find connected nodes via co-occurrence links
        const connectedSkills = new Set();
        links.forEach(l => {
          if (l.source === d) connectedSkills.add(l.target.skill);
          if (l.target === d) connectedSkills.add(l.source.skill);
        });
        allGroups.filter(n => n !== d).transition().duration(200)
          .attr('opacity', n => connectedSkills.has(n.skill) ? 0.7 : 0.15);
        allLinks.transition().duration(200)
          .attr('opacity', l => (l.source === d || l.target === d) ? 0.7 : 0.02)
          .attr('stroke', l => (l.source === d || l.target === d) ? d.color : '#222235')
          .attr('stroke-width', l => (l.source === d || l.target === d) ? 1.5 + (l.weight / maxWeight) * 2 : 0.3);
        const [mx, my] = d3.pointer(event, svg.node());
        const pct = ((d.mentions / maxMentions) * 100).toFixed(1);
        const coList = connectedSkills.size > 0
          ? `<div class="kde-tooltip__cooccur">Co-occurs with: ${[...connectedSkills].slice(0, 5).join(', ')}${connectedSkills.size > 5 ? ` +${connectedSkills.size - 5} more` : ''}</div>`
          : '';
        tooltip.style('opacity', 1).style('left', `${mx + 18}px`).style('top', `${my - 15}px`)
          .html(`
            <div class="kde-tooltip__title">${d.skill}</div>
            <div class="kde-tooltip__value">${d.mentions.toLocaleString()} mentions</div>
            <div class="kde-tooltip__rank">Rank #${d.index + 1} · ${pct}% of top</div>
            <div class="kde-tooltip__bar"><div class="kde-tooltip__bar-fill" style="width:${pct}%;background:${d.color}"></div></div>
            ${coList}
          `);
      })
      .on('mousemove', function (event) {
        const [mx, my] = d3.pointer(event, svg.node());
        tooltip.style('left', `${mx + 18}px`).style('top', `${my - 15}px`);
      })
      .on('mouseleave', function (_, d) {
        const sel = d3.select(this);
        sel.select('.main-circle')
          .transition().duration(300).attr('r', d.r).attr('stroke-width', 1.5).attr('stroke-opacity', 0.6)
          .attr('filter', 'url(#bubble-glow)');
        sel.select('.glow-ring')
          .transition().duration(300).attr('r', d.r + 4).attr('opacity', 0.3).attr('stroke-width', 1.5);
        sel.select('.skill-label').transition().duration(300).attr('font-size', `${Math.max(8, Math.min(13, d.r * 0.35))}px`);
        allGroups.transition().duration(300).attr('opacity', 1);
        allLinks.transition().duration(300)
          .attr('opacity', l => 0.08 + (l.weight / maxWeight) * 0.25)
          .attr('stroke', '#334155')
          .attr('stroke-width', l => 0.5 + (l.weight / maxWeight) * 2);
        tooltip.style('opacity', 0);
      });

    // ── DRAG ──
    const drag = d3.drag()
      .on('start', (event, d) => { if (!event.active && simRef.current) simRef.current.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on('end', (event, d) => { if (!event.active && simRef.current) simRef.current.alphaTarget(0); d.fx = null; d.fy = null; if (hoverRef.current) simRef.current.stop(); });
    allGroups.call(drag);

    // ── SIMULATION ──
    if (simRef.current) simRef.current.stop();

    const simulation = d3.forceSimulation(nodes)
      .force('center', d3.forceCenter(cx, cy).strength(0.04))
      .force('charge', d3.forceManyBody().strength(d => -d.r * 1.5))
      .force('collide', d3.forceCollide().radius(d => d.r + 5).strength(0.9).iterations(3))
      .force('x', d3.forceX(cx).strength(0.03))
      .force('y', d3.forceY(cy).strength(0.03))
      .alphaDecay(0.015)
      // On updates (not first draw), start with lower alpha so it doesn't explode
      .alpha(isInit ? 1 : 0.3)
      .on('tick', () => {
        nodes.forEach(d => {
          d.x = Math.max(d.r + 5, Math.min(W - d.r - 5, d.x));
          d.y = Math.max(d.r + 5, Math.min(H - d.r - 5, d.y));
        });
        allGroups.attr('transform', d => `translate(${d.x},${d.y})`);
        allLinks
          .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      });

    simRef.current = simulation;

    // Breathing pulse (only start on first draw)
    if (isInit) {
      function pulse() {
        svg.selectAll('.glow-ring')
          .transition().duration(2000).ease(d3.easeSinInOut).attr('stroke-opacity', 0.5)
          .transition().duration(2000).ease(d3.easeSinInOut).attr('stroke-opacity', 0.15)
          .on('end', pulse);
      }
      setTimeout(pulse, 1500);
    }
  }, [data, cooccurrence, dimensions]);

  useEffect(() => {
    buildChart();
    return () => { if (simRef.current) simRef.current.stop(); };
  }, [buildChart]);

  // Freeze simulation while pointer is over the chart area
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onEnter = () => {
      hoverRef.current = true;
      if (simRef.current) simRef.current.stop();
    };
    const onLeave = () => {
      hoverRef.current = false;
      if (simRef.current && simRef.current.alpha() > simRef.current.alphaMin()) simRef.current.restart();
    };
    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('pointerleave', onLeave);
    return () => { el.removeEventListener('pointerenter', onEnter); el.removeEventListener('pointerleave', onLeave); };
  }, []);

  if (!data.length) return <p className="empty-state">No skill data available yet.</p>;

  return (
    <div ref={containerRef} className="kde-container" style={{ width: '100%', position: 'relative' }}>
      <svg ref={svgRef} style={{ width: '100%', height: dimensions.height }} />
      <div ref={tooltipRef} className="kde-tooltip" />
    </div>
  );
}

export default memo(SkillsKDE, (prev, next) => {
  if (prev.height !== next.height) return false;
  if (prev.data.length !== next.data.length) return false;
  if (prev.cooccurrence.length !== next.cooccurrence.length) return false;
  if (!prev.data.every((d, i) => d.skill === next.data[i].skill && d.mentions === next.data[i].mentions)) return false;
  if (!prev.cooccurrence.every((c, i) => c.source === next.cooccurrence[i].source && c.target === next.cooccurrence[i].target && c.weight === next.cooccurrence[i].weight)) return false;
  return true;
});
