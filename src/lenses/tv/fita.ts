/**
 * O transporte da TV: a apuração como gravação.
 *
 * O servidor guarda cada leitura publicada e devolve o estado de um instante qualquer. Aqui isso
 * vira três gestos na lateral — voltar ao começo, tocar, pausar —, as velocidades e um relógio que
 * diz de que hora é o painel no ar. Tocando, o tempo corre a 60 ou 100 minutos de apuração por
 * segundo, que é o passo em que uma virada de madrugada cabe num intervalo de comercial. Ao chegar
 * no fim de uma apuração que ainda está de pé, o painel volta sozinho para o ao vivo — é onde ele
 * tem de terminar.
 *
 * Esta peça não sabe desenhar nada do painel: ela decide qual instante está no ar e pede a quem
 * sabe, por `mostrar`.
 */
import { loadTimeline, type Timeline } from '../../shell/dados';

/** As acelerações oferecidas, em minutos de apuração por segundo de relógio. */
export const VELOCIDADES = [1, 60, 100];

/** Os três gestos, desenhados: começo, toca, pausa. */
export const ICO = {
  ini: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M19 5.8v12.4L9.5 12z" fill="currentColor"/></svg>',
  toca: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.2v13.6L19 12z" fill="currentColor"/></svg>',
  pausa: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7.5" y="5" width="3.4" height="14" rx="1.1" fill="currentColor"/><rect x="13.1" y="5" width="3.4" height="14" rx="1.1" fill="currentColor"/></svg>',
};

/** O HTML da fita, para o palco montar junto com o resto. */
export const fitaHtml = () => `<nav class="fita" aria-label="Reprodução da apuração">`
  + `<button class="ini" title="Voltar ao início da apuração" aria-label="Voltar ao início">${ICO.ini}</button>`
  + `<button class="toca" title="Reproduzir a apuração" aria-label="Reproduzir">${ICO.toca}</button>`
  + `<button class="pausa" title="Pausar" aria-label="Pausar">${ICO.pausa}</button>`
  + VELOCIDADES.map(v => `<button class="vel" data-v="${v}" title="${v} vez${v === 1 ? '' : 'es'} mais rápido">${v}×</button>`).join('')
  + `<button class="vivo" title="Voltar ao ao vivo" aria-label="Ao vivo"><i></i></button>`
  + `<span class="quando">ao vivo</span></nav>`;

export interface Transporte {
  /** Verdadeiro quando o painel mostra o agora, e não um instante reproduzido. */
  aoVivo(): boolean;
}

export function montarTransporte(o: {
  elemento: HTMLElement;
  /** Põe no ar o instante pedido; sem argumento, o ao vivo. */
  mostrar: (at?: number) => Promise<void>;
  /** Falso quando a aba está escondida ou é uma cópia pré-renderizada: aí nada é pedido. */
  visivel: () => boolean;
}): Transporte {
  const { elemento: fita } = o;
  let linha: Timeline | null = null, lidoEm = 0;
  let momento: number | null = null;     // nulo é o ao vivo
  let tocando = false;
  let velocidade = 60;
  let buscando = false;

  const aoVivo = () => momento === null;
  const fimAgora = () => !linha ? Date.now() : linha.live ? linha.end + (Date.now() - lidoEm) : linha.end;
  const relogio = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
  });

  const ler = async () => {
    if (buscando) return;
    buscando = true;
    try { await o.mostrar(momento ?? undefined); }
    catch { /* o painel segue com a última leitura */ }
    finally { buscando = false; }
  };

  const pintar = () => {
    fita.classList.toggle('some', !linha?.available);
    fita.classList.toggle('vivo', aoVivo());
    fita.querySelector('.toca')!.classList.toggle('on', tocando);
    fita.querySelector('.pausa')!.classList.toggle('on', !tocando && !aoVivo());
    fita.querySelector('.vivo')!.classList.toggle('on', aoVivo());
    for (const b of fita.querySelectorAll<HTMLElement>('.vel')) {
      b.classList.toggle('on', Number(b.dataset.v) === velocidade);
    }
    fita.querySelector('.quando')!.textContent = aoVivo() ? 'ao vivo' : relogio(momento!);
  };

  const irPara = (ms: number, toca: boolean) => {
    if (!linha) return;
    momento = Math.max(linha.start, Math.min(ms, fimAgora()));
    tocando = toca;
    void ler(); pintar();
  };
  const voltarAoVivo = () => { momento = null; tocando = false; void ler(); pintar(); };

  fita.querySelector('.ini')!.addEventListener('click', () => linha && irPara(linha.start, false));
  fita.querySelector('.toca')!.addEventListener('click', () => {
    if (!linha?.available) return;
    // tocar do ponto onde parou; no ao vivo, ou no fim da gravação, recomeça do início
    if (aoVivo() || momento! >= fimAgora() - 1000) irPara(linha.start, true);
    else { tocando = true; pintar(); }
  });
  fita.querySelector('.pausa')!.addEventListener('click', () => { tocando = false; pintar(); });
  for (const seletor of ['.vivo', '.quando']) {
    fita.querySelector(seletor)!.addEventListener('click', () => { if (!aoVivo()) voltarAoVivo(); });
  }
  for (const b of fita.querySelectorAll<HTMLElement>('.vel')) {
    b.addEventListener('click', () => { velocidade = Number(b.dataset.v); pintar(); });
  }

  const lerLinha = async () => {
    try { linha = await loadTimeline(); lidoEm = Date.now(); } catch { /* mantém a anterior */ }
    pintar();
  };
  void lerLinha();
  setInterval(() => { if (o.visivel()) void lerLinha(); }, 15_000);

  // o relógio da reprodução: avança o instante e repinta, buscando um estado novo a cada 600 ms
  let ultimo = performance.now(), ultimaBusca = 0;
  setInterval(() => {
    const agora = performance.now(), dt = agora - ultimo; ultimo = agora;
    if (aoVivo() || !tocando || !linha || !o.visivel()) return;
    momento! += dt * velocidade;
    if (momento! >= fimAgora()) {
      if (linha.live) { voltarAoVivo(); return; }
      momento = fimAgora(); tocando = false;
    }
    if (Date.now() - ultimaBusca >= 600) { ultimaBusca = Date.now(); void ler(); }
    pintar();
  }, 250);

  return { aoVivo };
}
