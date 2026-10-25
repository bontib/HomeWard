/* @ds-bundle: {"format":4,"namespace":"HomeWard","components":[{"name":"Button"},{"name":"RiskBadge"},{"name":"VersionTag"},{"name":"DeviceIcon"},{"name":"DeviceCard"},{"name":"CveItem"},{"name":"NetworkSummary"},{"name":"DeviceTypePicker"},{"name":"AddDeviceTile"}]} */
(function () {
  var R = window.React, h = R.createElement;
  function cx() { return Array.prototype.filter.call(arguments, Boolean).join(' '); }
  function rest(p, omit) { var o = {}; for (var k in p) if (omit.indexOf(k) < 0) o[k] = p[k]; return o; }

  /* ---- icon paths (24×24, 1.75 stroke, round caps) ---- */
  var DEVICE = {
    pc: ['M3 4h18v12H3z', 'M8 20h8', 'M12 16v4'],
    laptop: ['M5 5h14v10H5z', 'M2 19h20'],
    console: ['M6 8h12a4 4 0 0 1 4 4v1a4 4 0 0 1-7 2.6L14 15h-4l-1 .6A4 4 0 0 1 2 13v-1a4 4 0 0 1 4-4z', 'M7 11v3', 'M5.5 12.5h3', 'M16 12h.01', 'M18 13.5h.01'],
    tv: ['M2 5h20v13H2z', 'M8 21h8'],
    phone: ['M7 2h10v20H7z', 'M11 18h2'],
    tablet: ['M4 3h16v18H4z', 'M11 18h2'],
    speaker: ['M6 2h12v20H6z', 'M12 14m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0', 'M12 6h.01'],
    camera: ['M12 10m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0', 'M12 10m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0', 'M8 21h8', 'M12 16v5'],
    plug: ['M9 2v5', 'M15 2v5', 'M6 7h12v4a6 6 0 0 1-12 0z', 'M12 17v5'],
    bulb: ['M9 18h6', 'M10 22h4', 'M12 2a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5v1h6v-1c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 2z'],
    thermostat: ['M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0', 'M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0', 'M12 8v4'],
    router: ['M3 14h18v6H3z', 'M7 17h.01', 'M11 17h.01', 'M7 14l-2-6', 'M17 14l2-6'],
    doorbell: ['M8 2h8v20H8z', 'M12 7m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0', 'M12 16m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0'],
    printer: ['M6 9V3h12v6', 'M3 9h18v8H3z', 'M7 14h10v7H7z'],
    other: ['M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0', 'M8 12h.01', 'M12 12h.01', 'M16 12h.01']
  };
  var DEVICE_LABEL = { pc: 'PC', laptop: 'Laptop', console: 'Game console', tv: 'TV', phone: 'Phone', tablet: 'Tablet', speaker: 'Smart speaker', camera: 'Camera', plug: 'Smart plug', bulb: 'Smart light', thermostat: 'Thermostat', router: 'Router', doorbell: 'Doorbell', printer: 'Printer', other: 'Other' };
  var RISK = {
    safe:       { label: 'Up to date',       d: ['M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z', 'M8.5 12l2.5 2.5 4.5-5'] },
    update:     { label: 'Update available', d: ['M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0', 'M12 16V8', 'M8.5 11.5L12 8l3.5 3.5'] },
    vulnerable: { label: 'Vulnerable',       d: ['M12 3l10 18H2z', 'M12 10v4', 'M12 17.5h.01'] },
    critical:   { label: 'Critical',         d: ['M8 2h8l6 6v8l-6 6H8l-6-6V8z', 'M12 7v6', 'M12 16.5h.01'] },
    unknown:    { label: 'Not checked',      d: ['M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0', 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14', 'M12 17.5h.01'] }
  };
  var ORDER = ['critical', 'vulnerable', 'update', 'safe', 'unknown'];

  function Svg(paths, cls) {
    return h('svg', { className: cls, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
      paths.map(function (d, i) { return h('path', { key: i, d: d }); }));
  }
  function riskFromScore(s) { return s >= 9 ? 'critical' : s >= 4 ? 'vulnerable' : 'update'; }

  function Button(p) {
    var v = p.variant || 'primary';
    return h('button', Object.assign({ type: 'button' }, rest(p, ['variant', 'size', 'className', 'children']), {
      className: cx('hg-btn', 'hg-btn-' + v, p.size === 'sm' && 'hg-btn-sm', p.className)
    }), p.children);
  }

  function RiskBadge(p) {
    var lv = RISK[p.level] ? p.level : 'unknown';
    return h('span', { className: cx('hg-badge', 'hg-badge-' + lv, p.className) }, Svg(RISK[lv].d, 'hg-icon-sm'), p.children || RISK[lv].label);
  }

  function VersionTag(p) {
    var behind = p.latest && p.latest !== p.current;
    return h('span', { className: cx('hg-version', 'hg-mono', p.className), title: behind ? 'Installed ' + p.current + ', latest ' + p.latest : 'Installed ' + (p.current || 'unknown') },
      h('span', null, p.current ? 'v' + p.current : 'version ?'),
      behind && h('span', { className: 'hg-version-arrow', 'aria-hidden': true }, '→'),
      behind && h('span', { className: 'hg-version-latest' }, p.latest));
  }

  function DeviceIcon(p) {
    var t = DEVICE[p.type] ? p.type : 'other';
    return h('span', { className: cx('hg-device-icon', p.size === 'lg' && 'hg-device-icon-lg', p.className), role: 'img', 'aria-label': DEVICE_LABEL[t] }, Svg(DEVICE[t]));
  }

  function DeviceCard(p) {
    var lv = p.risk || 'unknown', n = p.cveCount || 0;
    return h('button', { type: 'button', className: cx('hg-card', p.className), onClick: p.onClick },
      h('div', { className: 'hg-card-head' },
        h(DeviceIcon, { type: p.type }),
        h('div', { style: { minWidth: 0, flex: 1 } },
          h('p', { className: 'hg-card-name' }, p.name),
          h('p', { className: 'hg-card-meta' }, [p.vendor, p.product, p.room].filter(Boolean).join(' · ')))),
      h('div', { className: 'hg-row', style: { padding: 0 } }, h(RiskBadge, { level: lv }), h(VersionTag, { current: p.version, latest: p.latest })),
      h('div', { className: 'hg-card-foot' },
        h('span', { className: 'hg-card-cves', style: { color: n ? 'var(--' + lv + ')' : 'var(--ink-muted)' } }, n ? n + (n === 1 ? ' known vulnerability' : ' known vulnerabilities') : 'No known vulnerabilities'),
        h('span', { className: 'hg-card-meta' }, p.checked || '')));
  }

  function CveItem(p) {
    var lv = p.level || riskFromScore(p.score || 0);
    return h('article', { className: cx('hg-cve', p.className) },
      h('div', { className: 'hg-cve-score', style: { background: 'var(--' + lv + '-tint)', color: 'var(--' + lv + ')' }, title: 'CVSS score' }, (p.score != null ? Number(p.score).toFixed(1) : '–')),
      h('div', { className: 'hg-cve-head' }, h('span', { className: 'hg-mono hg-muted' }, p.id), h(RiskBadge, { level: lv }), p.exploited && h(RiskBadge, { level: 'critical' }, 'Exploited in the wild')),
      h('p', { className: 'hg-cve-title' }, p.title),
      h('div', { style: { gridColumn: 2, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' } },
        p.summary && h('p', { className: 'hg-cve-body' }, p.summary),
        p.fixedIn && h('p', { className: 'hg-cve-fix' }, 'Fixed in ', h('span', { className: 'hg-mono' }, p.fixedIn))));
  }

  function NetworkSummary(p) {
    var c = p.counts || {}, total = ORDER.reduce(function (s, k) { return s + (c[k] || 0); }, 0);
    var bad = (c.critical || 0) + (c.vulnerable || 0);
    var title = p.title || (c.critical ? c.critical + (c.critical === 1 ? ' device needs' : ' devices need') + ' fixing now' : bad ? bad + (bad === 1 ? ' device is' : ' devices are') + ' vulnerable' : c.update ? 'Safe, with updates waiting' : 'Your home network looks safe');
    return h('section', { className: cx('hg-summary', p.className) },
      h('div', null, h('p', { className: 'hg-card-meta' }, total + ' devices · ' + (p.checked || 'checked just now')), h('h2', { className: 'hg-summary-title' }, title)),
      h('div', { className: 'hg-summary-bar', role: 'img', 'aria-label': ORDER.map(function (k) { return (c[k] || 0) + ' ' + RISK[k].label; }).join(', ') },
        ORDER.filter(function (k) { return c[k]; }).map(function (k) { return h('span', { key: k, className: 'hg-fill-' + k, style: { flex: c[k] } }); })),
      h('ul', { className: 'hg-summary-legend' }, ORDER.map(function (k) {
        return h('li', { key: k }, h('span', { className: 'hg-dot hg-fill-' + k }), h('span', null, h('b', null, c[k] || 0), ' ', RISK[k].label.toLowerCase()));
      })),
      p.action);
  }

  function DeviceTypePicker(p) {
    var types = p.types || ['console', 'pc', 'laptop', 'tv', 'phone', 'tablet', 'speaker', 'camera', 'bulb', 'plug', 'thermostat', 'router', 'doorbell', 'printer', 'other'];
    var st = R.useState(p.value || null), val = st[0], set = st[1];
    return h('div', { className: cx('hg-picker', p.className), role: 'group', 'aria-label': 'Device type' }, types.map(function (t) {
      return h('button', { key: t, type: 'button', className: 'hg-type', 'aria-pressed': val === t, onClick: function () { set(t); p.onChange && p.onChange(t); } }, Svg(DEVICE[t] || DEVICE.other), DEVICE_LABEL[t] || t);
    }));
  }

  function AddDeviceTile(p) {
    return h('button', { type: 'button', className: cx('hg-add', p.className), onClick: p.onClick },
      Svg(['M12 5v14', 'M5 12h14'], 'hg-icon'), p.label || 'Add a device', h('small', null, p.hint || 'Console, TV, PC or smart home'));
  }

  window.HomeWard = Object.assign(window.HomeWard || {}, { Button: Button, RiskBadge: RiskBadge, VersionTag: VersionTag, DeviceIcon: DeviceIcon, DeviceCard: DeviceCard, CveItem: CveItem, NetworkSummary: NetworkSummary, DeviceTypePicker: DeviceTypePicker, AddDeviceTile: AddDeviceTile, riskFromScore: riskFromScore });
})();
