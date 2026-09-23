// Fabricated test fixture shaped from the TSE EA20 specification. Not election data.
export const config2026 = {
  c: 'ele2026', f: 'o', pl: [
    { cd: '999', dt: '04/10/2026', e: [
      { cd: '9001', t: '1', abr: [{ cd: 'br', cp: [{ cd: '1' }] }] },
      { cd: '9002', t: '1', abr: [{ cd: 'mg', cp: [{ cd: '3' }, { cd: '5' }, { cd: '6' }, { cd: '7' }] }, { cd: 'df', cp: [{ cd: '3' }, { cd: '5' }, { cd: '6' }, { cd: '8' }] }] },
    ] },
    { cd: '1000', dt: '25/10/2026', e: [{ cd: '9003', t: '2', abr: [{ cd: 'br', cp: [{ cd: '1' }] }] }] },
  ],
};

export function resultFixture(office = 1, uf = 'br') {
  return {
    ele: '9001', t: '1', f: 'o', sup: 'n', tpabr: uf === 'br' ? 'br' : 'uf', cdabr: uf,
    dg: '04/10/2026', hg: '18:30:00', dt: '04/10/2026', ht: '18:29:50', idg: '123', dv: 's', tf: 'n', and: 'p',
    carg: [{ cd: String(office), nv: office === 5 ? '2' : '1', agr: [{ par: [
      { n: '10', sg: 'TESTE A', tvtn: '600', tvtl: '10', cand: [{ n: '10', sqcand: '000001', nmu: 'Candidatura de teste A', vap: '600', pvap: '60,00', pvapn: '60.000000000', e: 'n', st: '' }] },
      { n: '20', sg: 'TESTE B', tvtn: '400', tvtl: '0', cand: [{ n: '20', sqcand: '000002', nmu: 'Candidatura de teste B', vap: '400', pvap: '40,00', pvapn: '40.000000000', e: 'n', st: '' }] },
    ] }] }],
    s: { ts: '100', st: '75', pst: '75,00', pstn: '75.000000000' },
    e: { te: '2000', c: '1000', a: '250', pan: '20.000000000' },
    v: { vv: '1000', tv: '1100', vb: '30', tvn: '70' },
  };
}
