import { PDFDocument } from 'pdf-lib';
import { useEffect, useState } from 'react';
import { haversine, formatSurface } from '../utils/geo';

function buildAirportText({ label, code, airport }) {
  const runways = Array.isArray(airport.runways) && airport.runways.length
    ? airport.runways.map((runway) => (
        `- ${runway.rwy_id}: ${runway.length}' x ${runway.width}' ${formatSurface(runway.surface)} (${runway.condition})`
      ))
    : ['- None'];
  const approaches = Array.isArray(airport.approaches) && airport.approaches.length
    ? airport.approaches.map((approach) => (
        approach.pdf_url ? `- ${approach.name}: ${approach.pdf_url}` : `- ${approach.name}`
      ))
    : ['- None'];

  return [
    `${label}: ${code}`,
    `${airport.airport_name}`,
    `${airport.city}, ${airport.state}`,
    `Elev ${airport.elevation} ft | Fuel ${airport.fuel} | Class ${airport.airspace}`,
    '',
    'Runways:',
    ...runways,
    '',
    'Instrument Approaches:',
    ...approaches,
  ].join('\n');
}

async function mergeSummaryWithApproachPlates(summaryBlob, selectedApproaches) {
  if (!selectedApproaches.length) {
    return summaryBlob;
  }

  const summaryDoc = await PDFDocument.load(await summaryBlob.arrayBuffer());

  for (const approach of selectedApproaches) {
    try {
      const response = await fetch(approach.pdfUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const approachDoc = await PDFDocument.load(await response.arrayBuffer(), {
        ignoreEncryption: true,
      });
      const copiedPages = await summaryDoc.copyPages(approachDoc, approachDoc.getPageIndices());
      copiedPages.forEach((page) => summaryDoc.addPage(page));
    } catch (error) {
      console.warn('[SummaryModal] Failed to append approach plate', approach.pdfUrl, error);
    }
  }

  const mergedBytes = await summaryDoc.save();
  return new Blob([mergedBytes], { type: 'application/pdf' });
}

function escapePdfText(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function escapePdfUrl(value) {
  return escapePdfText(value).replace(/\s/g, '%20');
}

function wrapLine(line, maxChars) {
  if (!line) return [''];
  const words = line.split(/\s+/);
  const lines = [];
  let current = '';

  words.forEach((word) => {
    if (word.length > maxChars) {
      if (current) {
        lines.push(current);
        current = '';
      }
      for (let index = 0; index < word.length; index += maxChars) {
        lines.push(word.slice(index, index + maxChars));
      }
      return;
    }

    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  });

  if (current) lines.push(current);
  return lines;
}

function makePdfBuilder() {
  const pageWidth = 612;
  const pageHeight = 792;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
  ];
  const pages = [];
  let page = null;

  const addPage = () => {
    page = { lines: [], annotations: [], images: [] };
    pages.push(page);
    return page;
  };

  const command = (line) => page.lines.push(line);
  const colorValue = (value) => value
    .split(/\s+/)
    .map((component) => {
      const number = Number(component);
      const normalized = number > 1 ? number / 255 : number;
      return Number.isFinite(normalized) ? normalized.toFixed(3) : '0';
    })
    .join(' ');
  const text = (x, y, value, { size = 9, font = 'F1', color = '20 31 47' } = {}) => {
    command('BT');
    command(`/${font} ${size} Tf`);
    command(`${colorValue(color)} rg`);
    command(`${x} ${y} Td`);
    command(`(${escapePdfText(value)}) Tj`);
    command('ET');
  };
  const rect = (x, y, width, height, { fill = null, stroke = null, lineWidth = 1 } = {}) => {
    command('q');
    if (fill) {
      command(`${colorValue(fill)} rg`);
      command(`${x} ${y} ${width} ${height} re f`);
    }
    if (stroke) {
      command(`${colorValue(stroke)} RG`);
      command(`${lineWidth} w`);
      command(`${x} ${y} ${width} ${height} re S`);
    }
    command('Q');
  };
  const line = (x1, y1, x2, y2, { stroke = '37 99 235', lineWidth = 1.5 } = {}) => {
    command('q');
    command(`${colorValue(stroke)} RG`);
    command(`${lineWidth} w`);
    command(`${x1} ${y1} m ${x2} ${y2} l S`);
    command('Q');
  };
  const polyline = (points, options) => {
    if (points.length < 2) return;
    command('q');
    command(`${colorValue(options?.stroke || '37 99 235')} RG`);
    command(`${options?.lineWidth || 2} w`);
    command(`${points[0][0]} ${points[0][1]} m`);
    points.slice(1).forEach(([x, y]) => command(`${x} ${y} l`));
    command('S');
    command('Q');
  };
  const linkAnnotation = (x, y, width, height, url) => {
    page.annotations.push({ x, y, width, height, url });
  };
  const jpegImage = (image, x, y, width, height) => {
    const name = `Im${page.images.length + 1}`;
    page.images.push({ ...image, name });
    command('q');
    command(`${width} 0 0 ${height} ${x} ${y} cm`);
    command(`/${name} Do`);
    command('Q');
  };

  addPage();

  const finalize = () => {
    const pageRefs = [];

    pages.forEach((pdfPage) => {
      const content = pdfPage.lines.join('\n');
      const annotRefs = pdfPage.annotations.map((annotation) => {
        const objectNumber = objects.length + 1;
        const rectSpec = [
          annotation.x,
          annotation.y,
          annotation.x + annotation.width,
          annotation.y + annotation.height,
        ].join(' ');
        objects.push(
          `<< /Type /Annot /Subtype /Link /Rect [${rectSpec}] /Border [0 0 0] ` +
          `/A << /S /URI /URI (${escapePdfUrl(annotation.url)}) >> >>`
        );
        return `${objectNumber} 0 R`;
      });
      const imageRefs = pdfPage.images.map((image) => {
        const objectNumber = objects.length + 1;
        objects.push(
          `<< /Type /XObject /Subtype /Image /Width ${image.pixelWidth} /Height ${image.pixelHeight} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${image.hex.length} >>\n` +
          `stream\n${image.hex}\nendstream`
        );
        return [image.name, `${objectNumber} 0 R`];
      });
      const imageResourcePart = imageRefs.length
        ? ` /XObject << ${imageRefs.map(([name, ref]) => `/${name} ${ref}`).join(' ')} >>`
        : '';
      const contentObjectNumber = objects.length + 1;
      objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);

      const pageObjectNumber = objects.length + 1;
      const annotationPart = annotRefs.length ? ` /Annots [${annotRefs.join(' ')}]` : '';
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >>${imageResourcePart} >> ` +
        `/Contents ${contentObjectNumber} 0 R${annotationPart} >>`
      );
      pageRefs.push(`${pageObjectNumber} 0 R`);
    });

    objects[1] = `<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pageRefs.length} >>`;

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(pdf.length);
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });

    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    offsets.slice(1).forEach((offset) => {
      pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
    pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

    return new Blob([pdf], { type: 'application/pdf' });
  };

  return {
    pageWidth,
    pageHeight,
    addPage,
    get pageIndex() {
      return pages.length - 1;
    },
    text,
    rect,
    line,
    polyline,
    jpegImage,
    linkAnnotation,
    finalize,
  };
}

function dataUrlToPdfJpeg(dataUrl) {
  const binary = atob(dataUrl.split(',')[1] || '');
  let hex = '';
  for (let index = 0; index < binary.length; index += 1) {
    hex += binary.charCodeAt(index).toString(16).padStart(2, '0');
  }
  return { hex: `${hex}>` };
}

function latLonToTilePixel(lat, lon, zoom) {
  const scale = 256 * (2 ** zoom);
  const latRad = (lat * Math.PI) / 180;
  return [
    ((lon + 180) / 360) * scale,
    ((1 - Math.log(Math.tan(latRad) + (1 / Math.cos(latRad))) / Math.PI) / 2) * scale,
  ];
}

function chooseMapZoom(stops, width, height) {
  const paddingRatio = 0.72;
  let bestZoom = 5;

  for (let zoom = 3; zoom <= 11; zoom += 1) {
    const pixels = stops.map(({ airport }) => latLonToTilePixel(airport.lat, airport.lon, zoom));
    const xs = pixels.map(([x]) => x);
    const ys = pixels.map(([, y]) => y);
    const routeWidth = Math.max(...xs) - Math.min(...xs);
    const routeHeight = Math.max(...ys) - Math.min(...ys);
    if (routeWidth <= width * paddingRatio && routeHeight <= height * paddingRatio) {
      bestZoom = zoom;
    }
  }

  return bestZoom;
}

function loadTileImage(url) {
  return new Promise((resolve) => {
    const image = new Image();
    const timeout = setTimeout(() => resolve(null), 2500);
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      clearTimeout(timeout);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timeout);
      resolve(null);
    };
    image.src = url;
  });
}

function drawCanvasMarker(ctx, x, y, code, isHome) {
  ctx.save();
  ctx.fillStyle = isHome ? '#111827' : '#2563eb';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(x, y, isHome ? 9 : 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.font = 'bold 18px Arial, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#111827';
  ctx.strokeText(code, x + 13, y);
  ctx.fillText(code, x + 13, y);
  ctx.restore();
}

async function createRouteMapJpeg(stops, width = 1000, height = 640) {
  const validStops = stops.filter(({ airport }) => (
    Number.isFinite(airport?.lat) && Number.isFinite(airport?.lon)
  ));
  if (validStops.length < 2) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#dbeafe';
  ctx.fillRect(0, 0, width, height);

  const zoom = chooseMapZoom(validStops, width, height);
  const routePixels = validStops.map(({ airport }) => latLonToTilePixel(airport.lat, airport.lon, zoom));
  const centerPixel = routePixels.reduce(
    ([sumX, sumY], [x, y]) => [sumX + x, sumY + y],
    [0, 0]
  ).map((sum) => sum / routePixels.length);
  const topLeft = [centerPixel[0] - width / 2, centerPixel[1] - height / 2];
  const maxTile = 2 ** zoom;
  const minTileX = Math.floor(topLeft[0] / 256);
  const maxTileX = Math.floor((topLeft[0] + width) / 256);
  const minTileY = Math.floor(topLeft[1] / 256);
  const maxTileY = Math.floor((topLeft[1] + height) / 256);
  const tiles = [];

  for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      if (tileY < 0 || tileY >= maxTile) continue;
      const wrappedTileX = ((tileX % maxTile) + maxTile) % maxTile;
      tiles.push({
        tileX,
        tileY,
        url: `https://tile.openstreetmap.org/${zoom}/${wrappedTileX}/${tileY}.png`,
      });
    }
  }

  await Promise.all(tiles.map(async (tile) => {
    const image = await loadTileImage(tile.url);
    if (!image) return;
    ctx.drawImage(
      image,
      Math.round(tile.tileX * 256 - topLeft[0]),
      Math.round(tile.tileY * 256 - topLeft[1]),
      256,
      256
    );
  }));

  const canvasRoutePoints = routePixels.map(([x, y]) => [
    Math.round(x - topLeft[0]),
    Math.round(y - topLeft[1]),
  ]);
  canvasRoutePoints.push(canvasRoutePoints[0]);

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 14;
  ctx.beginPath();
  canvasRoutePoints.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.strokeStyle = '#d946ef';
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.restore();

  validStops.forEach(({ code }, index) => {
    const [x, y] = canvasRoutePoints[index];
    drawCanvasMarker(ctx, x, y, code, index === 0);
  });

  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(14, height - 45, 285, 30);
  ctx.fillStyle = '#334155';
  ctx.font = '15px Arial, sans-serif';
  ctx.fillText('Map data © OpenStreetMap contributors', 24, height - 25);
  ctx.restore();

  try {
    return {
      ...dataUrlToPdfJpeg(canvas.toDataURL('image/jpeg', 0.88)),
      pixelWidth: width,
      pixelHeight: height,
    };
  } catch (err) {
    return null;
  }
}

function drawRouteSketch(pdf, stops, box) {
  const validStops = stops.filter(({ airport }) => (
    Number.isFinite(airport?.lat) && Number.isFinite(airport?.lon)
  ));
  pdf.rect(box.x, box.y, box.width, box.height, { fill: '239 246 255', stroke: '148 163 184' });

  if (validStops.length < 2) {
    pdf.text(box.x + 12, box.y + box.height / 2, 'Map coordinates unavailable', { size: 9, color: '100 116 139' });
    return;
  }

  for (let gridIndex = 1; gridIndex <= 3; gridIndex += 1) {
    const gridX = box.x + (box.width / 4) * gridIndex;
    const gridY = box.y + (box.height / 4) * gridIndex;
    pdf.line(gridX, box.y + 26, gridX, box.y + box.height - 30, { stroke: '203 213 225', lineWidth: 0.5 });
    pdf.line(box.x + 12, gridY, box.x + box.width - 12, gridY, { stroke: '203 213 225', lineWidth: 0.5 });
  }

  const lats = validStops.map(({ airport }) => airport.lat);
  const lons = validStops.map(({ airport }) => airport.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const lonSpan = Math.max(maxLon - minLon, 0.2);
  const latSpan = Math.max(maxLat - minLat, 0.2);
  const plot = {
    x: box.x + 18,
    y: box.y + 22,
    width: box.width - 36,
    height: box.height - 58,
  };
  const project = (airport) => [
    Math.round(plot.x + ((airport.lon - minLon) / lonSpan) * plot.width),
    Math.round(plot.y + ((airport.lat - minLat) / latSpan) * plot.height),
  ];
  const routePoints = validStops.map(({ airport }) => project(airport));
  routePoints.push(routePoints[0]);
  pdf.polyline(routePoints, { stroke: '37 99 235', lineWidth: 2.5 });

  validStops.forEach(({ code, label, airport }, index) => {
    const [x, y] = project(airport);
    const isHome = index === 0;
    pdf.rect(x - 4, y - 4, 8, 8, {
      fill: isHome ? '17 24 39' : '37 99 235',
      stroke: '255 255 255',
      lineWidth: 1,
    });
    pdf.text(x + 7, y + 5, code, { font: 'F2', size: 8, color: isHome ? '17 24 39' : '37 99 235' });
    pdf.text(x + 7, y - 6, label.replace(' Destination', ''), { size: 6, color: '100 116 139' });
  });
}

function textWidthEstimate(value, size = 9) {
  return String(value).length * size * 0.53;
}

function maxCharsForWidth(width, size = 9) {
  return Math.max(12, Math.floor(width / Math.max(size * 0.53, 1)));
}

function countWrappedLines(value, maxChars) {
  return wrapLine(value, maxChars).length;
}

function drawWrappedText(pdf, value, x, y, options = {}) {
  const size = options.size || 9;
  const maxChars = options.maxChars || 84;
  const lineHeight = options.lineHeight || size + 4;
  let cursorY = y;
  wrapLine(value, maxChars).forEach((line) => {
    pdf.text(x, cursorY, line, options);
    cursorY -= lineHeight;
  });
  return cursorY;
}

function getCardStyle(width, compact = false) {
  if (compact) {
    return {
      width,
      paddingX: 10,
      headerHeight: 28,
      headerFontSize: 10.5,
      nameFontSize: 10,
      nameLineHeight: 12,
      metaFontSize: 7.8,
      metaLineHeight: 10,
      sectionFontSize: 8.5,
      sectionGap: 10,
      runwayFontSize: 7,
      runwayLineHeight: 10,
      approachFontSize: 7.5,
      approachLineHeight: 11,
      minHeight: 150,
      baseHeight: 102,
    };
  }

  return {
    width,
    paddingX: 14,
    headerHeight: 34,
    headerFontSize: 13,
    nameFontSize: 12,
    nameLineHeight: 15,
    metaFontSize: 9,
    metaLineHeight: 13,
    sectionFontSize: 10,
    sectionGap: 13,
    runwayFontSize: 8,
    runwayLineHeight: 13,
    approachFontSize: 9,
    approachLineHeight: 14,
    minHeight: 210,
    baseHeight: 142,
  };
}

function measureAirportCard(section, width, compact = false) {
  const style = getCardStyle(width, compact);
  const contentWidth = width - (style.paddingX * 2);
  const nameLines = countWrappedLines(section.airport.airport_name || '', maxCharsForWidth(contentWidth, style.nameFontSize));
  const runways = Array.isArray(section.airport.runways) && section.airport.runways.length ? section.airport.runways : [];
  const approaches = Array.isArray(section.airport.approaches) && section.airport.approaches.length ? section.airport.approaches : [];
  const runwayLines = runways.length
    ? runways.reduce((sum, runway) => {
        const line = `${runway.rwy_id}: ${runway.length}' x ${runway.width}' ${formatSurface(runway.surface)} (${runway.condition})`;
        return sum + countWrappedLines(line, maxCharsForWidth(contentWidth, style.runwayFontSize));
      }, 0)
    : 1;
  const approachLines = approaches.length
    ? approaches.reduce((sum, approach) => (
        sum + countWrappedLines(approach.name || 'Approach PDF', maxCharsForWidth(contentWidth, style.approachFontSize))
      ), 0)
    : 1;

  return Math.max(
    style.minHeight,
    style.baseHeight +
      (nameLines * style.nameLineHeight) +
      (runwayLines * style.runwayLineHeight) +
      (approachLines * style.approachLineHeight)
  );
}

function drawAirportCard(pdf, section, x, topY, width, compact = false) {
  const { label, code, airport } = section;
  const style = getCardStyle(width, compact);
  const cardHeight = measureAirportCard(section, width, compact);
  const bottomY = topY - cardHeight;
  const contentX = x + style.paddingX;
  const contentWidth = width - (style.paddingX * 2);
  let y = topY - (style.headerHeight - 11);

  pdf.rect(x, bottomY, width, cardHeight, { fill: '248 250 252', stroke: '203 213 225' });
  pdf.rect(x, topY - style.headerHeight, width, style.headerHeight, { fill: '30 41 59' });
  pdf.text(contentX, topY - (style.headerHeight - 10), `${label}: ${code}`, {
    font: 'F2',
    size: style.headerFontSize,
    color: '255 255 255',
  });
  y = topY - (style.headerHeight + 17);
  y = drawWrappedText(pdf, airport.airport_name, contentX, y, {
    font: 'F2',
    size: style.nameFontSize,
    color: '17 24 39',
    maxChars: maxCharsForWidth(contentWidth, style.nameFontSize),
    lineHeight: style.nameLineHeight,
  });
  pdf.text(contentX, y, `${airport.city}, ${airport.state}`, { size: style.metaFontSize, color: '71 85 105' });
  y -= style.metaLineHeight;
  pdf.text(contentX, y, `Elev ${airport.elevation} ft   Fuel ${airport.fuel}   Class ${airport.airspace}`, {
    size: style.metaFontSize,
    color: '71 85 105',
  });

  y -= style.sectionGap + 9;
  pdf.text(contentX, y, 'Runways', { font: 'F2', size: style.sectionFontSize, color: '17 24 39' });
  y -= style.runwayLineHeight;
  const runways = Array.isArray(airport.runways) && airport.runways.length ? airport.runways : [];
  if (runways.length === 0) {
    pdf.text(contentX, y, 'None', { size: style.metaFontSize, color: '100 116 139' });
    y -= style.runwayLineHeight;
  } else {
    runways.forEach((runway) => {
      const line = `${runway.rwy_id}: ${runway.length}' x ${runway.width}' ${formatSurface(runway.surface)} (${runway.condition})`;
      y = drawWrappedText(pdf, line, contentX, y, {
        font: 'F3',
        size: style.runwayFontSize,
        color: '30 41 59',
        maxChars: maxCharsForWidth(contentWidth, style.runwayFontSize),
        lineHeight: style.runwayLineHeight,
      });
    });
  }

  y -= style.sectionGap - 3;
  pdf.text(contentX, y, 'Instrument Approaches', { font: 'F2', size: style.sectionFontSize, color: '17 24 39' });
  y -= style.approachLineHeight;
  const approaches = Array.isArray(airport.approaches) && airport.approaches.length ? airport.approaches : [];
  if (approaches.length === 0) {
    pdf.text(contentX, y, 'None', { size: style.metaFontSize, color: '100 116 139' });
  } else {
    approaches.forEach((approach) => {
      const name = approach.name || 'Approach PDF';
      const lines = wrapLine(name, maxCharsForWidth(contentWidth, style.approachFontSize));
      const startY = y;
      y = drawWrappedText(pdf, name, contentX, y, {
        size: style.approachFontSize,
        color: approach.pdf_url ? '2 132 199' : '30 41 59',
        maxChars: maxCharsForWidth(contentWidth, style.approachFontSize),
        lineHeight: style.approachLineHeight,
      });
      if (approach.pdf_url) {
        lines.forEach((line, index) => {
          const lineY = startY - (index * style.approachLineHeight);
          const linkWidth = Math.min(textWidthEstimate(line, style.approachFontSize), contentWidth);
          pdf.line(contentX, lineY - 2, contentX + linkWidth, lineY - 2, { stroke: '2 132 199', lineWidth: 0.6 });
        });
        pdf.linkAnnotation(
          contentX,
          y + 3,
          contentWidth,
          Math.max(12, lines.length * style.approachLineHeight),
          approach.pdf_url
        );
      }
    });
  }

  return bottomY;
}

function fitsSinglePageStack(sections, topY, width, compact = false, bottomMargin = 42, gap = 16) {
  let cursorY = topY;
  for (const section of sections) {
    const cardHeight = measureAirportCard(section, width, compact);
    if (cursorY - cardHeight < bottomMargin) return false;
    cursorY -= cardHeight + gap;
  }
  return true;
}

function buildColumnPlacements(sections, topY, left, right, bottomMargin = 42, gap = 16) {
  const columnWidth = (right - left - gap) / 2;
  const columns = [
    { x: left, y: topY },
    { x: left + columnWidth + gap, y: topY },
  ];
  const placements = [];

  for (const section of sections) {
    const targetIndex = columns[1].y > columns[0].y ? 1 : 0;
    const target = columns[targetIndex];
    const cardHeight = measureAirportCard(section, columnWidth, true);
    if (target.y - cardHeight < bottomMargin) return null;
    placements.push({
      section,
      x: target.x,
      topY: target.y,
      width: columnWidth,
      compact: true,
    });
    target.y -= cardHeight + gap;
  }

  return placements;
}

function buildGraphicalSummaryPdfBlob(report, routeMapImage) {
  const pdf = makePdfBuilder();
  const left = 42;
  const right = 570;
  const fullWidth = right - left;
  const stackedTop = 535;
  const compactTop = 568;
  const useCompactLayout = !fitsSinglePageStack(report.airportSections, stackedTop, fullWidth, false);
  const compactPlacements = useCompactLayout
    ? buildColumnPlacements(report.airportSections, compactTop, left, right)
    : null;
  const singlePageCompact = Boolean(compactPlacements);
  const titleTop = useCompactLayout ? 752 : 748;

  pdf.text(left, titleTop, 'Cross Country Trip Summary', {
    font: 'F2',
    size: useCompactLayout ? 20 : 22,
    color: '17 24 39',
  });
  pdf.text(left, titleTop - 18, report.routeName, {
    font: 'F2',
    size: useCompactLayout ? 11 : 12,
    color: '37 99 235',
  });
  pdf.text(left, titleTop - 35, `Total ${report.total.toFixed(1)} NM`, {
    font: 'F2',
    size: useCompactLayout ? 13 : 15,
    color: '17 24 39',
  });

  const distanceBoxY = useCompactLayout ? 620 : 602;
  const distanceBoxHeight = useCompactLayout ? 82 : 100;
  pdf.rect(left, distanceBoxY, 245, distanceBoxHeight, { fill: '239 246 255', stroke: '147 197 253' });
  pdf.text(left + 12, distanceBoxY + distanceBoxHeight - 24, 'DISTANCES', {
    font: 'F2',
    size: useCompactLayout ? 9 : 10,
    color: '30 64 175',
  });
  report.distanceLines.forEach((distanceLine, index) => {
    pdf.text(left + 12, distanceBoxY + distanceBoxHeight - 46 - (index * (useCompactLayout ? 13 : 16)), distanceLine, {
      font: 'F3',
      size: useCompactLayout ? 8.5 : 10,
      color: '30 41 59',
    });
  });
  const advisoryLines = useCompactLayout
    ? ['Always review NOTAMs, weather, and airport', 'conditions before departure.']
    : ['Always review NOTAMs, weather, and current airport conditions before departure.'];
  advisoryLines.forEach((lineText, index) => {
    pdf.text(left + 4, distanceBoxY - 14 - (index * 10), lineText, {
      size: useCompactLayout ? 7 : 7.8,
      color: '100 116 139',
    });
  });

  const mapBox = {
    x: 318,
    y: useCompactLayout ? 606 : 570,
    width: 232,
    height: useCompactLayout ? 110 : 150,
  };
  if (routeMapImage) {
    pdf.rect(mapBox.x, mapBox.y, mapBox.width, mapBox.height, { fill: '239 246 255', stroke: '148 163 184' });
    pdf.jpegImage(routeMapImage, mapBox.x + 8, mapBox.y + 8, mapBox.width - 16, mapBox.height - 16);
  } else {
    drawRouteSketch(pdf, report.airportSections, mapBox);
  }

  if (singlePageCompact) {
    compactPlacements.forEach(({ section, x, topY, width, compact }) => {
      drawAirportCard(pdf, section, x, topY, width, compact);
    });
  } else {
    let cardTop = stackedTop;
    report.airportSections.forEach((section) => {
      const cardHeight = measureAirportCard(section, fullWidth, false);
      if (cardTop - cardHeight < 42) {
        pdf.addPage();
        cardTop = 748;
      }
      cardTop = drawAirportCard(pdf, section, left, cardTop, fullWidth, false) - 16;
    });
  }

  return pdf.finalize();
}

function SummaryPdfViewer({ report, reportKey, selectedApproaches, onDocumentReady }) {
  const [pdfUrl, setPdfUrl] = useState('');

  useEffect(() => {
    let active = true;
    let nextUrl = '';

    setPdfUrl('');
    onDocumentReady?.(null);

    (async () => {
      const routeMapImage = await createRouteMapJpeg(report.airportSections);
      const summaryBlob = buildGraphicalSummaryPdfBlob(report, routeMapImage);
      const blob = await mergeSummaryWithApproachPlates(summaryBlob, selectedApproaches);
      const url = URL.createObjectURL(blob);
      if (!active) {
        URL.revokeObjectURL(url);
        return;
      }
      nextUrl = url;
      setPdfUrl(url);
      onDocumentReady?.(blob);
    })();

    return () => {
      active = false;
      onDocumentReady?.(null);
      if (nextUrl) URL.revokeObjectURL(nextUrl);
    };
  }, [reportKey, onDocumentReady]);

  if (!pdfUrl) {
    return (
      <div className="summary-pdf-fallback">
        {selectedApproaches.length > 0
          ? `Building PDF with ${selectedApproaches.length} selected approach plate${selectedApproaches.length === 1 ? '' : 's'}...`
          : 'Building PDF...'}
      </div>
    );
  }

  return (
    <iframe
      className="summary-pdf-viewer"
      title="Trip Summary PDF"
      src={pdfUrl}
    />
  );
}

export default function SummaryModal({
  open,
  onClose,
  airportData,
  loadAirportDetails,
  homeCode,
  firstLegCode,
  secondLegCode,
  tripType,
}) {
  const [reportMode, setReportMode] = useState('pdf');
  const [pdfBlob, setPdfBlob] = useState(null);
  const [shareSupported, setShareSupported] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [selectedApproachKeys, setSelectedApproachKeys] = useState([]);

  useEffect(() => {
    if (open) {
      setReportMode('pdf');
      setPdfBlob(null);
      setSelectedApproachKeys([]);
    }
  }, [open, homeCode, firstLegCode, secondLegCode]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const media = window.matchMedia('(max-width: 900px)');
    const update = () => {
      setShareSupported(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
    };

    update();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update);
      return () => media.removeEventListener('change', update);
    }

    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  useEffect(() => {
    if (!open) return;

    const codes = [homeCode, firstLegCode];
    if (tripType === 'two' && secondLegCode) {
      codes.push(secondLegCode);
    }
    loadAirportDetails?.(codes);
  }, [open, homeCode, firstLegCode, secondLegCode, tripType, loadAirportDetails]);

  const home = airportData[homeCode];
  const first = airportData[firstLegCode];
  const second = secondLegCode ? airportData[secondLegCode] : null;
  const hasRequiredSelection = Boolean(open && homeCode && firstLegCode);
  const hasRequiredAirports = Boolean(home && first);
  const detailsReady = Boolean(
    hasRequiredAirports &&
    home.detailsLoaded &&
    first.detailsLoaded &&
    !(tripType === 'two' && secondLegCode && !second?.detailsLoaded)
  );

  if (!hasRequiredSelection) return null;
  if (!hasRequiredAirports) return null;
  if (!detailsReady) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal-card" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>Trip Summary</h2>
            <button type="button" className="icon-btn" onClick={onClose}>
              ✕
            </button>
          </div>
          <div className="summary-pdf-fallback">Loading detailed airport info...</div>
        </div>
      </div>
    );
  }

  const leg1 = hasRequiredAirports ? haversine(home.lat, home.lon, first.lat, first.lon) : 0;
  const leg2 = hasRequiredAirports && second ? haversine(first.lat, first.lon, second.lat, second.lon) : 0;
  const leg3 = hasRequiredAirports ? (second ? haversine(second.lat, second.lon, home.lat, home.lon) : leg1) : 0;
  const total = second ? leg1 + leg2 + leg3 : leg1 * 2;

  const airportSections = [
    { label: 'Home Base', code: homeCode, airport: home },
    { label: 'First Destination', code: firstLegCode, airport: first },
    second ? { label: 'Second Destination', code: secondLegCode, airport: second } : null,
  ].filter(Boolean);

  const distanceLines = [
    `${homeCode} -> ${firstLegCode}: ${leg1.toFixed(1)} NM`,
    tripType === 'two' && secondLegCode
      ? `${firstLegCode} -> ${secondLegCode}: ${leg2.toFixed(1)} NM`
      : `${firstLegCode} -> ${homeCode}: ${leg1.toFixed(1)} NM`,
    tripType === 'two' && secondLegCode
      ? `${secondLegCode} -> ${homeCode}: ${leg3.toFixed(1)} NM`
      : null,
  ].filter(Boolean);

  const routeName = [...airportSections.map(({ code }) => code), homeCode].join(' -> ');

  const sectionDivider = '------------------------------';
  const summaryText = [
    'Cross Country Trip Summary',
    '',
    `Course: ${routeName}`,
    `Total: ${total.toFixed(1)} NM`,
    '',
    'Leg Distances:',
    ...distanceLines,
    '',
    ...airportSections.flatMap((section) => [
      sectionDivider,
      '',
      buildAirportText(section),
      '',
    ]),
  ].join('\n');

  const summaryReport = {
    airportSections,
    distanceLines,
    routeName,
    total,
  };
  const approachOptions = airportSections.flatMap((section) => (
    (Array.isArray(section.airport.approaches) ? section.airport.approaches : [])
      .filter((approach) => approach?.pdf_url)
      .map((approach) => ({
        key: `${section.code}::${approach.name}`,
        airportCode: section.code,
        airportLabel: `${section.label}: ${section.code}`,
        approachName: approach.name,
        pdfUrl: approach.pdf_url,
      }))
  ));
  const selectedApproaches = approachOptions.filter((approach) => selectedApproachKeys.includes(approach.key));

  const fileBaseName = routeName.replace(/[^A-Z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'trip_summary';
  const reportKey = [
    routeName,
    total.toFixed(1),
    ...distanceLines,
    ...airportSections.map((section) => `${section.label}:${section.code}`),
    ...selectedApproachKeys,
  ].join('|');
  const toggleApproachSelection = (approachKey) => {
    setSelectedApproachKeys((current) => (
      current.includes(approachKey)
        ? current.filter((key) => key !== approachKey)
        : [...current, approachKey]
    ));
  };

  const handleShare = async () => {
    if (sharing) return;

    setSharing(true);
    try {
      if (reportMode === 'pdf' && pdfBlob) {
        const pdfFile = new File([pdfBlob], `${fileBaseName}.pdf`, {
          type: 'application/pdf',
        });

        if (
          shareSupported &&
          typeof navigator.canShare === 'function' &&
          navigator.canShare({ files: [pdfFile] })
        ) {
          await navigator.share({
            title: 'Cross Country Trip Summary',
            files: [pdfFile],
          });
          return;
        }

        const pdfUrl = URL.createObjectURL(pdfBlob);
        const link = document.createElement('a');
        link.href = pdfUrl;
        link.download = `${fileBaseName}.pdf`;
        link.rel = 'noopener';
        link.click();
        setTimeout(() => URL.revokeObjectURL(pdfUrl), 0);
        return;
      }

      if (shareSupported) {
        await navigator.share({
          title: 'Cross Country Trip Summary',
          text: summaryText,
        });
        return;
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(summaryText);
        return;
      }

      const textBlob = new Blob([summaryText], { type: 'text/plain;charset=utf-8' });
      const textUrl = URL.createObjectURL(textBlob);
      const link = document.createElement('a');
      link.href = textUrl;
      link.download = `${fileBaseName}.txt`;
      link.rel = 'noopener';
      link.click();
      setTimeout(() => URL.revokeObjectURL(textUrl), 0);
    } catch (error) {
      if (error?.name !== 'AbortError') {
        console.error('[SummaryModal] share failed', error);
      }
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Trip Summary</h2>
          <button type="button" className="icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="summary-actions">
          <div className="summary-view-toggle" role="tablist" aria-label="Summary format">
            <button
              type="button"
              role="tab"
              aria-selected={reportMode === 'pdf'}
              className={reportMode === 'pdf' ? 'active' : ''}
              onClick={() => setReportMode('pdf')}
            >
              PDF
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={reportMode === 'text'}
              className={reportMode === 'text' ? 'active' : ''}
              onClick={() => setReportMode('text')}
            >
              Text
            </button>
          </div>
          <button
            type="button"
            className="icon-btn summary-share-btn"
            aria-label="Send to"
            title="Send to"
            disabled={sharing || (reportMode === 'pdf' && !pdfBlob)}
            onClick={handleShare}
          >
            ⤴
          </button>
        </div>

        {approachOptions.length > 0 && (
          <div className="summary-plate-picker">
            <div className="summary-plate-title">Attach Approach Plates To PDF</div>
            <div className="summary-plate-hint">
              Select approach plates to append as extra pages after the trip summary when printing or downloading the PDF.
            </div>
            <div className="summary-plate-list">
              {approachOptions.map((approach) => (
                <label key={approach.key} className="summary-plate-option">
                  <input
                    type="checkbox"
                    checked={selectedApproachKeys.includes(approach.key)}
                    onChange={() => toggleApproachSelection(approach.key)}
                  />
                  <span>
                    <strong>{approach.airportLabel}</strong>
                    <span>{approach.approachName}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="summary-content-shell">
          {reportMode === 'text' ? (
            <textarea className="summary-text-report" value={summaryText} readOnly />
          ) : (
            <SummaryPdfViewer
              report={summaryReport}
              reportKey={reportKey}
              selectedApproaches={selectedApproaches}
              onDocumentReady={setPdfBlob}
            />
          )}
        </div>
      </div>
    </div>
  );
}
