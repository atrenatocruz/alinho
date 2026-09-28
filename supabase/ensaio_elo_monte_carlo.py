#!/usr/bin/env python3
"""
Ensaio Monte Carlo do rating (RANKING.md, parte 2) — 28 set 2026.

Compara variantes do motor num clube simulado, ao ritmo do piloto (1 mix por
semana, 4 jogos por mix). Não lê nada da base de dados: o "nível real" de
cada jogador é sorteado e os resultados dos jogos saem da fórmula do
esperado aplicada aos níveis reais. Serve para ordens de grandeza.

    python3 supabase/ensaio_elo_monte_carlo.py            # os 4 ensaios
    python3 supabase/ensaio_elo_monte_carlo.py clube      # só um

Ensaios:
  clube     50 jogadores 850–1200, 13 semanas: erro, mudanças de nível
  novos     40 veteranos + 10 novos (30 % mal declarados): K do novato
  extremos  declarou M3 e é M6 / declarou M6 e é M4, só com M6
  invicto   ganha tudo no campo de cima: quanto sobe

Modelos:
  antigo    #440: K 40/30/20 @8/20, soma zero, repartição 35/65, prémio
            da noite +1 % (+0,5 % noite perfeita) pago por surpresa, trava
  simples   migration_elo_simples.sql: K 20, K 40 nos primeiros 12 jogos só
            para o próprio, cada um da dupla leva o mesmo, sem prémio
"""
import random
import statistics as st
import sys


def E(ra, rb):
    return 1 / (1 + 10 ** ((rb - ra) / 400))


def band(r):
    return 1 if r >= 1800 else 2 if r >= 1600 else 3 if r >= 1400 else 4 if r >= 1200 else 5 if r >= 1000 else 6 if r >= 700 else 7


# ── os dois motores, para um jogo 2v2 ────────────────────────────────────
def jogo_antigo(r, g, s_a):
    def kg(n):
        return 40 if n < 8 else 30 if n < 20 else 20
    ks = [kg(x) for x in g]
    K = sum(ks) / 4
    M = 2 * K * (s_a - E((r[0] + r[1]) / 2, (r[2] + r[3]) / 2))
    out = [0.0] * 4
    for i, (a, b) in enumerate([(0, 1), (2, 3)]):
        s_t = s_a if i == 0 else 1 - s_a
        w = min(.65, max(.35, r[b] / (r[a] + r[b]))) if (s_t == 1 and r[a] + r[b] > 0) else .5
        pa, pb = w * ks[a], (1 - w) * ks[b]
        t = pa + pb
        sg = 1 if i == 0 else -1
        out[a], out[b] = sg * M * pa / t, sg * M * pb / t
    losers = [i for i in range(4) if out[i] < 0]
    winners = [i for i in range(4) if out[i] > 0]
    lost = 0
    for i in losers:
        out[i] = -min(-out[i], max(r[i], 0))
        lost += -out[i]
    ws = sum(out[i] for i in winners) or 1
    for i in winners:
        out[i] = lost * out[i] / ws
    return out


def jogo_simples(r, g, s_a, k_novo=40, janela=12):
    e = E((r[0] + r[1]) / 2, (r[2] + r[3]) / 2)
    return [(k_novo if g[i] < janela else 20) * ((s_a - e) if i < 2 else (e - s_a)) for i in range(4)]


# ── uma noite de mix: 8 pessoas, 4 duplas fixas, 4 jogos ─────────────────
def noite(grp, rating, games, true, motor, rnd, premio):
    pairs = [(grp[j], grp[j + 1]) for j in range(0, 8, 2)]
    before = {x: rating[x] for x in grp}
    wins = {p: 0 for p in pairs}
    lost_to = {x: {} for x in grp}
    gs = [(a, b) for a in range(4) for b in range(a + 1, 4)]
    rnd.shuffle(gs)
    for a, b in gs[:4]:
        pa, pb = pairs[a], pairs[b]
        p = [*pa, *pb]
        r = [rating[x] for x in p]
        g = [games[x] for x in p]
        s = 1.0 if rnd.random() < E((true[pa[0]] + true[pa[1]]) / 2, (true[pb[0]] + true[pb[1]]) / 2) else 0.0
        for x, d in zip(p, motor(r, g, s)):
            rating[x] = max(0, rating[x] + d)
            games[x] += 1
        winp, losp = (pa, pb) if s == 1 else (pb, pa)
        wins[winp] += 1
        e_los = E((before[losp[0]] + before[losp[1]]) / 2, (before[winp[0]] + before[winp[1]]) / 2)
        for x in losp:
            lost_to[x][winp] = lost_to[x].get(winp, 0) + e_los
    if not premio:
        return
    champ = max(pairs, key=lambda pr: (wins[pr], rnd.random()))
    prize = {}
    for x in champ:
        amt = (0.01 + (0.005 if wins[champ] == 3 else 0)) * rating[x]
        opp = [y for y in grp if y not in champ]
        gap = before[x] - st.mean(before[y] for y in opp)
        delta = rating[x] - before[x]
        if gap >= 150:
            amt = max(0, min(amt, (5 if gap >= 300 else 15) - delta))
        prize[x] = amt
    total = sum(prize.values())
    payers = {x: v[champ] for x, v in lost_to.items() if champ in v}
    ps = sum(payers.values())
    if total > 0 and ps > 0:
        for x, wgt in payers.items():
            rating[x] = max(0, rating[x] - total * wgt / ps)
        for x, amt in prize.items():
            rating[x] += amt


def semana(rating, games, true, motor, rnd, premio):
    n = len(rating)
    order = sorted(range(n), key=lambda i: rating[i] + rnd.gauss(0, 40))
    for i in range(0, n - 7, 8):
        noite(order[i:i + 8], rating, games, true, motor, rnd, premio)


def declarado(t, rnd, p_acima=0.25):
    return 1100.0 if (t >= 975 or rnd.random() < p_acima) else 850.0


MODELOS = {
    'antigo (#440, com prémio)': (jogo_antigo, True),
    'antigo sem prémio': (jogo_antigo, False),
    'simples (K20, K40×12 só o próprio)': (jogo_simples, False),
    'K20 puro': (lambda r, g, s: jogo_simples(r, g, s, 20, 0), False),
}


def ensaio_clube(seeds=40, weeks=13, n=50):
    print(f"\n== CLUBE: {n} jogadores 850–1200, declarado N5/N6 (25 % acima), {weeks} semanas ==")
    print(f"{'modelo':38} {'erro ini→fim':>12} {'ordem':>6} {'muda nível':>10} {'nível certo':>12} {'maior +/−':>10}")
    for nm, (motor, premio) in MODELOS.items():
        acc = []
        for s in range(seeds):
            rnd = random.Random(s)
            true = [rnd.uniform(850, 1200) for _ in range(n)]
            rating = [declarado(t, rnd) for t in true]
            start = rating[:]
            games = [0] * n
            for _ in range(weeks):
                semana(rating, games, true, motor, rnd, premio)
            def ranks(v):
                o = sorted(range(n), key=lambda i: v[i])
                rk = [0] * n
                for k, i in enumerate(o):
                    rk[i] = k
                return rk
            ra, rt = ranks(rating), ranks(true)
            rho = 1 - 6 * sum((ra[i] - rt[i]) ** 2 for i in range(n)) / (n * (n * n - 1))
            d = [rating[i] - start[i] for i in range(n)]
            acc.append((st.mean(abs(start[i] - true[i]) for i in range(n)),
                        st.mean(abs(rating[i] - true[i]) for i in range(n)), rho,
                        sum(band(rating[i]) != band(start[i]) for i in range(n)) / n * 100,
                        sum(band(start[i]) == band(true[i]) for i in range(n)) / n * 100,
                        sum(band(rating[i]) == band(true[i]) for i in range(n)) / n * 100,
                        max(d), min(d)))
        m = lambda k: st.mean(a[k] for a in acc)
        print(f"{nm:38} {m(0):5.0f}→{m(1):4.0f}   {m(2):6.2f} {m(3):9.0f}% {m(4):5.0f}%→{m(5):3.0f}% {m(6):+5.0f}/{m(7):+.0f}")


def ensaio_novos(seeds=40, weeks=13):
    print("\n== NOVOS: 40 veteranos (±50) + 10 novos, 30 % com erro grosseiro (M3 ou Iniciante) ==")
    print(f"{'K do novo (só o próprio)':26} {'erro novos':>10} {'erro veteranos':>14} {'inflação':>9} {'|Δ| bem declarados':>18}")
    for nm, kn, jan in (('K20 sempre', 20, 0), ('K30 × 12', 30, 12), ('K40 × 12', 40, 12), ('K60 × 8', 60, 8), ('K120 × 8', 120, 8)):
        motor = lambda r, g, s, kn=kn, jan=jan: jogo_simples(r, g, s, kn, jan)
        acc = []
        for s in range(seeds):
            rnd = random.Random(s)
            true = [rnd.uniform(850, 1200) for _ in range(50)]
            rating, games = [], []
            for i, t in enumerate(true):
                if i < 40:
                    rating.append(t + rnd.gauss(0, 50)); games.append(40)
                else:
                    rating.append(float(rnd.choice([1500, 600])) if rnd.random() < 0.3 else declarado(t, rnd)); games.append(0)
            start = rating[:]
            for _ in range(weeks):
                semana(rating, games, true, motor, rnd, False)
            new, vet = range(40, 50), range(40)
            ok = [i for i in new if abs(start[i] - true[i]) < 150]
            acc.append((st.mean(abs(rating[i] - true[i]) for i in new), st.mean(abs(rating[i] - true[i]) for i in vet),
                        sum(rating) - sum(true), st.mean(abs(rating[i] - start[i]) for i in ok) if ok else 0))
        m = lambda k: st.mean(a[k] for a in acc)
        print(f"{nm:26} {m(0):10.0f} {m(1):14.0f} {m(2):+9.0f} {m(3):18.0f}")


def ensaio_extremos(seeds=200):
    POOL = 850
    print("\n== EXTREMOS: joga só com M6 (850), 1 mix × 4 jogos/semana. Semanas (mediana) até ao nível certo ==")
    def corre(decl, true, target, motor):
        res = []
        for s in range(seeds):
            rnd = random.Random(s)
            rx, gx = float(decl), 0
            ptrue = E((true + POOL) / 2, POOL)
            wk = 0
            while wk < 300:
                wk += 1
                for _ in range(4):
                    s_ = 1.0 if rnd.random() < ptrue else 0.0
                    d = motor([rx, POOL, POOL, POOL], [gx, 30, 30, 30], s_)[0]
                    rx = max(0, rx + d); gx += 1
                if (rx < target) if decl > true else (rx >= target):
                    break
            res.append(wk)
        return st.median(res)
    print(f"{'modelo':38} {'M3→M6 (1500, é 850)':>22} {'M6→M4 (850, é 1300)':>22}")
    for nm, (motor, _) in MODELOS.items():
        if 'prémio' in nm and 'sem' not in nm:
            continue  # o prémio depende da noite inteira; ver ensaio_clube
        print(f"{nm:38} {corre(1500, 850, 1000, motor):22.0f} {corre(850, 1300, 1200, motor):22.0f}")


def ensaio_invicto(seeds=50):
    print("\n== INVICTO: começa a 850, ganha todos os jogos, campo de cima (950–1050), 1 mix × 4 jogos/semana ==")
    print(f"{'modelo':38} {'2 meses':>8} {'6 meses':>8} {'1 ano':>8}")
    for nm, (motor, _) in MODELOS.items():
        if 'prémio' in nm and 'sem' not in nm:
            continue
        acc = []
        for s in range(seeds):
            rnd = random.Random(s)
            rx, gx, out = 850.0, 0, {}
            for wk in range(1, 53):
                for _ in range(4):
                    rp = rnd.uniform(950, 1050)
                    o1, o2 = rnd.uniform(950, 1050), rnd.uniform(950, 1050)
                    rx += motor([rx, rp, o1, o2], [gx, 30, 30, 30], 1.0)[0]; gx += 1
                if wk in (8, 26, 52):
                    out[wk] = rx
            acc.append(out)
        print(f"{nm:38} " + " ".join(f"{st.median(a[w] for a in acc):8.0f}" for w in (8, 26, 52)))


if __name__ == '__main__':
    quais = sys.argv[1:] or ['clube', 'novos', 'extremos', 'invicto']
    for q in quais:
        {'clube': ensaio_clube, 'novos': ensaio_novos, 'extremos': ensaio_extremos, 'invicto': ensaio_invicto}[q]()
