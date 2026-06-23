import { useRef, useEffect } from 'react';
import * as d3 from 'd3';

const COLORS = ['#ff3d5a', '#a855f7', '#06b6d4', '#22c55e', '#eab308', '#3b82f6', '#f97316', '#ec4899', '#14b8a6', '#f43f5e'];

export default function JobSunburst({ data }) {
  const svgRef = useRef();
  const tooltipRef = useRef();

  useEffect(() => {
    if (!data || !data.children || data.children.length === 0) return;

    const svg = d3.select(svgRef.current);
    const tooltip = d3.select(tooltipRef.current);

    const width = 500;
    const radius = width / 2;

    svg.attr('viewBox', `0 0 ${width} ${width}`);
    svg.selectAll('*').remove();

    const g = svg.append('g')
      .attr('transform', `translate(${radius},${radius})`);

    const root = d3.hierarchy(data)
      .sum((d) => d.value || 0)
      .sort((a, b) => b.value - a.value);

    d3.partition().size([2 * Math.PI, radius])(root);

    const sectorColor = {};
    root.children?.forEach((child, i) => {
      sectorColor[child.data.name] = COLORS[i % COLORS.length];
    });

    const arc = d3.arc()
      .startAngle((d) => d.x0)
      .endAngle((d) => d.x1)
      .padAngle(0.005)
      .padRadius(radius / 2)
      .innerRadius((d) => d.y0)
      .outerRadius((d) => d.y1 - 1);

    // Current view (for zoom)
    let currentRoot = root;

    function getColor(d) {
      if (d.depth === 0) return '#16161f';
      const ancestor = d.depth === 1 ? d : d.parent;
      const base = sectorColor[ancestor.data.name] || '#666';
      return d.depth === 1 ? base : d3.color(base).brighter(0.6).toString();
    }

    const paths = g.selectAll('path')
      .data(root.descendants().filter((d) => d.depth))
      .join('path')
      .attr('d', arc)
      .attr('fill', getColor)
      .attr('stroke', '#16161f')
      .attr('stroke-width', 0.5)
      .style('cursor', 'pointer')
      .on('mouseover', function (event, d) {
        d3.select(this).attr('fill', '#ffffff33').attr('stroke', '#fff').attr('stroke-width', 1.5);
        const ancestors = d.ancestors().reverse().slice(1).map((a) => a.data.name);
        tooltip
          .style('opacity', 1)
          .html(`<strong>${ancestors.join(' › ')}</strong><br/>${d.value} jobs`);
      })
      .on('mousemove', function (event) {
        tooltip
          .style('left', `${event.offsetX + 14}px`)
          .style('top', `${event.offsetY - 28}px`);
      })
      .on('mouseout', function (event, d) {
        d3.select(this).attr('fill', getColor(d)).attr('stroke', '#16161f').attr('stroke-width', 0.5);
        tooltip.style('opacity', 0);
      })
      .on('click', function (event, d) {
        if (d.depth === 1) {
          // Zoom into sector
          zoomTo(d);
        }
      });

    // Center label
    const centerLabel = g.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('fill', '#f0f0f5')
      .attr('font-size', 14)
      .attr('font-weight', 600)
      .style('cursor', 'pointer')
      .text('All Sectors')
      .on('click', () => zoomTo(root));

    function zoomTo(target) {
      currentRoot = target;
      const t = svg.transition().duration(600);

      paths.transition(t)
        .attrTween('d', (d) => {
          const xd = d3.interpolate(d._x0 || d.x0, d.x0);
          const xd1 = d3.interpolate(d._x1 || d.x1, d.x1);
          return () => arc(d);
        })
        .attr('fill-opacity', (d) => {
          if (target === root) return 1;
          return d === target || d.parent === target ? 1 : 0.15;
        });

      centerLabel.text(target === root ? 'All Sectors' : target.data.name);
    }

    // Add sector labels on arcs
    g.selectAll('text.arc-label')
      .data(root.descendants().filter((d) => d.depth === 1 && (d.x1 - d.x0) > 0.2))
      .join('text')
      .attr('class', 'arc-label')
      .attr('transform', (d) => {
        const angle = ((d.x0 + d.x1) / 2) * (180 / Math.PI) - 90;
        const r = (d.y0 + d.y1) / 2;
        return `rotate(${angle}) translate(${r},0) rotate(${angle > 90 ? 180 : 0})`;
      })
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('fill', '#f0f0f5')
      .attr('font-size', 10)
      .attr('pointer-events', 'none')
      .text((d) => d.data.name);

  }, [data]);

  return (
    <div className="sunburst-wrap" style={{ position: 'relative' }}>
      <svg ref={svgRef} style={{ width: '100%', height: 'auto' }} />
      <div
        ref={tooltipRef}
        className="d3-tooltip"
        style={{
          position: 'absolute',
          opacity: 0,
          pointerEvents: 'none',
          background: '#16161f',
          border: '1px solid #333355',
          borderRadius: 8,
          padding: '6px 12px',
          color: '#f0f0f5',
          fontSize: 13,
          whiteSpace: 'nowrap',
          transition: 'opacity 0.15s',
          zIndex: 10,
        }}
      />
    </div>
  );
}
