import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

// FAA VFR Sectional + TAC tiles are hosted once per domain under /vfr/ (see vfr-layers.js there).
// This adds a small on/off control to the map; the tiles are only requested after it is switched on.
const VFR_BASE = '/vfr';
const STORAGE_KEY = 'vfr_charts_on';

const COMPACT_CSS = `.vfr-charts-control label { margin: 0 !important; }
.vfr-charts-control input { padding: 0 !important; min-height: 0 !important; height: auto; }
@media (max-width: 767px) {
  .vfr-charts-control { gap: 1px !important; padding: 3px 7px !important; font-size: 12px !important; line-height: 1.1 !important; }
  .vfr-charts-control label { line-height: 1.1; }
  .vfr-charts-control input[type=checkbox] { width: 13px; height: 13px; }
  .vfr-charts-control input[type=range] { height: 14px; width: 70px !important; }
  .vfr-charts-control.vfr-below-header { margin-top: 84px !important; }
}`;

function ensureStyle() {
  if (document.getElementById('vfr-charts-style')) return;
  const el = document.createElement('style');
  el.id = 'vfr-charts-style';
  el.textContent = COMPACT_CSS;
  document.head.appendChild(el);
}

let helperPromise = null;
function loadHelper() {
  if (window.VFR) return Promise.resolve(window.VFR);
  if (!helperPromise) {
    helperPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${VFR_BASE}/vfr-layers.js`;
      script.onload = () => resolve(window.VFR);
      script.onerror = () => {
        helperPromise = null;
        reject(new Error('vfr-layers.js failed to load'));
      };
      document.head.appendChild(script);
    });
  }
  return helperPromise;
}

function readStored(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* storage unavailable: the setting just is not remembered */
  }
}

export default function VfrChartsControl({ position = 'topright', belowHeaderOnMobile = false }) {
  const map = useMap();

  useEffect(() => {
    ensureStyle();
    let vfr = null;
    let disposed = false;
    let on = readStored(STORAGE_KEY, '1') === '1';
    let tac = readStored(`${STORAGE_KEY}_tac`, '0') === '1';
    let opacity = Number(readStored(`${STORAGE_KEY}_opacity`, '0.9'));
    if (!(opacity >= 0 && opacity <= 1)) opacity = 0.9;

    let tacInput;
    let opacityInput;

    const syncUi = () => {
      tacInput.disabled = !on;
      opacityInput.disabled = !on;
      tacInput.parentElement.style.opacity = on ? '1' : '0.45';
      opacityInput.parentElement.style.opacity = on ? '1' : '0.45';
    };

    const apply = () => {
      syncUi();
      if (vfr) {
        vfr.setKind('sec', on);
        vfr.setKind('tac', on && tac);
        vfr.setOpacity(opacity);
        return;
      }
      if (!on) return;
      loadHelper()
        .then((VFR) => {
          if (disposed || vfr || !on) return;
          vfr = VFR.addTo(map, { base: VFR_BASE, opacity });
          vfr.setKind('tac', tac);
          vfr.ready.catch(() => {});
        })
        .catch(() => {});
    };

    const control = L.control({ position });
    control.onAdd = () => {
      const box = L.DomUtil.create(
        'div',
        `leaflet-bar vfr-charts-control${belowHeaderOnMobile ? ' vfr-below-header' : ''}`
      );
      box.style.cssText =
        'display:grid;gap:5px;padding:6px 9px;background:#fff;font:600 13px/1.2 system-ui,sans-serif;color:#0f172a;';
      const row = (parent) => {
        const el = L.DomUtil.create('label', '', parent);
        el.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;';
        return el;
      };

      const secRow = row(box);
      const secInput = L.DomUtil.create('input', '', secRow);
      secInput.type = 'checkbox';
      secInput.checked = on;
      secInput.style.cssText = 'margin:0;cursor:pointer;';
      secRow.appendChild(document.createTextNode('VFR Sectional'));

      const tacRow = row(box);
      tacRow.style.fontWeight = '500';
      tacRow.style.paddingLeft = '18px';
      tacInput = L.DomUtil.create('input', '', tacRow);
      tacInput.type = 'checkbox';
      tacInput.checked = tac;
      tacInput.style.cssText = 'margin:0;cursor:pointer;';
      tacRow.appendChild(document.createTextNode('TAC'));

      const opRow = row(box);
      opRow.style.fontWeight = '500';
      opRow.style.paddingLeft = '18px';
      opRow.appendChild(document.createTextNode('Opacity'));
      opacityInput = L.DomUtil.create('input', '', opRow);
      opacityInput.type = 'range';
      opacityInput.min = '0';
      opacityInput.max = '1';
      opacityInput.step = '0.05';
      opacityInput.value = String(opacity);
      opacityInput.style.cssText = 'width:80px;margin:0;';

      L.DomEvent.disableClickPropagation(box);
      L.DomEvent.disableScrollPropagation(box);
      secInput.addEventListener('change', () => {
        on = secInput.checked;
        writeStored(STORAGE_KEY, on ? '1' : '0');
        apply();
      });
      tacInput.addEventListener('change', () => {
        tac = tacInput.checked;
        writeStored(`${STORAGE_KEY}_tac`, tac ? '1' : '0');
        apply();
      });
      // Percent bubble above the thumb while the slider is being moved.
      box.style.position = 'relative';
      const tip = L.DomUtil.create('div', '', box);
      tip.style.cssText =
        'position:absolute;display:none;transform:translate(-50%,-100%);padding:2px 6px;border-radius:4px;background:#0f172a;color:#fff;font:600 12px/1.2 system-ui,sans-serif;pointer-events:none;white-space:nowrap;z-index:5;';
      let tipTimer = null;
      const showTip = (hideAfterMs) => {
        const ratio = (Number(opacityInput.value) - 0) / 1;
        const thumb = 14;
        const left = opacityInput.offsetLeft + thumb / 2 + ratio * (opacityInput.offsetWidth - thumb);
        tip.textContent = `${Math.round(Number(opacityInput.value) * 100)}%`;
        tip.style.left = `${left}px`;
        tip.style.top = `${opacityInput.offsetTop - 2}px`;
        tip.style.display = 'block';
        clearTimeout(tipTimer);
        if (hideAfterMs) tipTimer = setTimeout(() => (tip.style.display = 'none'), hideAfterMs);
      };
      opacityInput.addEventListener('pointerdown', () => showTip(0));
      ['pointerup', 'pointercancel', 'blur'].forEach((ev) =>
        opacityInput.addEventListener(ev, () => showTip(600))
      );
      opacityInput.addEventListener('input', () => {
        opacity = Number(opacityInput.value);
        writeStored(`${STORAGE_KEY}_opacity`, opacity);
        if (vfr) vfr.setOpacity(opacity);
        showTip(1200);
      });
      return box;
    };
    control.addTo(map);
    apply();

    return () => {
      disposed = true;
      control.remove();
      if (vfr) {
        vfr.setKind('sec', false);
        vfr.setKind('tac', false);
      }
    };
  }, [map, position, belowHeaderOnMobile]);

  return null;
}
