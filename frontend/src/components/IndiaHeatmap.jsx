import { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';

export default function IndiaHeatmap({ data = [] }) {
  const svgRef = useRef();
  const tooltipRef = useRef();
  const [geo, setGeo] = useState(null);

  // Load TopoJSON once
  useEffect(() => {
    fetch('/india-topo.json')
      .then((r) => r.json())
      .then((topo) => {
        const features = topojson.feature(topo, topo.objects.ind);
        setGeo(features);
      });
  }, []);

  // Draw map whenever geo or data changes
  useEffect(() => {
    if (!geo) return;

    const svg = d3.select(svgRef.current);
    const tooltip = d3.select(tooltipRef.current);

    const width = 500;
    const height = 560;

    svg.attr('viewBox', `0 0 ${width} ${height}`);
    svg.selectAll('*').remove();

    // Build state→count lookup
    const stateCount = {};
    data.forEach((d) => { stateCount[d.state] = d.count; });
    const maxCount = d3.max(data, (d) => d.count) || 1;

    const color = d3.scaleSequential()
      .domain([0, maxCount])
      .interpolator(d3.interpolateRgbBasis(['#0d0d1a', '#6b21a8', '#ff3d5a']));

    const projection = d3.geoMercator()
      .center([82, 22])
      .scale(900)
      .translate([width / 2, height / 2]);

    const path = d3.geoPath().projection(projection);

    // Draw states
    svg.append('g')
      .selectAll('path')
      .data(geo.features)
      .join('path')
      .attr('d', path)
      .attr('fill', (d) => {
        const name = d.properties.name;
        const count = stateCount[name] || 0;
        return count > 0 ? color(count) : '#111122';
      })
      .attr('stroke', '#333355')
      .attr('stroke-width', 0.5)
      .style('cursor', 'pointer')
      .on('mouseover', function (event, d) {
        const name = d.properties.name;
        const count = stateCount[name] || 0;
        d3.select(this)
          .attr('stroke', '#ff3d5a')
          .attr('stroke-width', 2)
          .raise();
        tooltip
          .style('opacity', 1)
          .html(`<strong>${name}</strong><br/>${count} jobs`)
          .style('left', `${event.offsetX + 12}px`)
          .style('top', `${event.offsetY - 28}px`);
      })
      .on('mousemove', function (event) {
        tooltip
          .style('left', `${event.offsetX + 12}px`)
          .style('top', `${event.offsetY - 28}px`);
      })
      .on('mouseout', function () {
        d3.select(this)
          .attr('stroke', '#333355')
          .attr('stroke-width', 0.5);
        tooltip.style('opacity', 0);
      });

    // Legend
    const legendWidth = 200;
    const legendHeight = 10;
    const legendX = width - legendWidth - 20;
    const legendY = height - 30;

    const defs = svg.append('defs');
    const grad = defs.append('linearGradient').attr('id', 'heatLegendGrad');
    grad.append('stop').attr('offset', '0%').attr('stop-color', '#0d0d1a');
    grad.append('stop').attr('offset', '50%').attr('stop-color', '#6b21a8');
    grad.append('stop').attr('offset', '100%').attr('stop-color', '#ff3d5a');

    svg.append('rect')
      .attr('x', legendX).attr('y', legendY)
      .attr('width', legendWidth).attr('height', legendHeight)
      .attr('rx', 4)
      .style('fill', 'url(#heatLegendGrad)');

    svg.append('text')
      .attr('x', legendX).attr('y', legendY - 4)
      .attr('fill', '#8888a0').attr('font-size', 10)
      .text('0');

    svg.append('text')
      .attr('x', legendX + legendWidth).attr('y', legendY - 4)
      .attr('fill', '#8888a0').attr('font-size', 10)
      .attr('text-anchor', 'end')
      .text(maxCount);

  }, [geo, data]);

  return (
    <div className="india-heatmap-wrap" style={{ position: 'relative' }}>
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
