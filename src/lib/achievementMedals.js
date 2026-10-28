// As medalhas pintadas das conquistas (design-handoff/2026-10-11-medalhas-
// conquistas, aprovado pelo Francisco a 11 out). Uma imagem por conquista em
// public/medalhas/<key>.webp (256 px, fundo transparente): ficheiros à parte,
// fora do pacote principal, que só se carregam quando aparecem. Uma conquista
// nova sem medalha fica com o ícone de sempre (achievementIcon).
const MEDAL_KEYS = new Set([
  'aluno_aplicado', 'anfitriao', 'ano_sem_falhar', 'anos_a_jogar', 'ar_rarefeito', 'areia_nos_tenis',
  'aula_experimental', 'bandeja_de_prata', 'bicampeao', 'bis', 'bom_de_balneario', 'cabeca_de_serie',
  'calibrado', 'campeao', 'campo_1', 'cartao_completo', 'centuriao_do_vidro', 'circuito_paralelo',
  'cliente_da_casa', 'contra_a_corrente', 'coruja_do_padel', 'dez_parceiros', 'dinastia', 'do_fundo_ao_topo',
  'dono_do_campo_1', 'dupla_de_sempre', 'em_chamas', 'embaixador', 'entre_amigos', 'escalada',
  'escudo_diamante', 'escudo_esmeralda', 'escudo_ouro', 'estreia_em_torneio', 'fair_play', 'fds_sagrado',
  'fim_de_tarde', 'final_four', 'fora_da_areia', 'gigante', 'hat_trick', 'idolo_da_bancada', 'imparavel',
  'in', 'inscricao_a_dois', 'invicto_no_torneio', 'jogo_de_grupo', 'lenda_viva', 'liga_interna',
  'madrugador', 'mao_quente', 'maquina_de_pontos', 'meio_ano_de_casa', 'meio_cento', 'meio_milhar',
  'mes_cheio', 'mvp_da_noite', 'nervos_de_aco', 'noite_perfeita', 'organizador', 'podio', 'premio_levantado',
  'primeira_bola', 'primeiro_a_chegar', 'primeiro_aplauso', 'primeiro_escudo', 'primeiro_grito',
  'punto_de_oro', 'querido_do_clube', 'quimica', 'recorde_da_casa', 'recrutador', 'regressado', 'rei_do_in',
  'remontada', 'residente', 'ritual_de_segunda', 'rivalidade', 'rosca', 'rosca_dupla', 'salto_do_banco',
  'semana_cheia', 'semana_sim_semana_sim', 'sempre_em_jogo', 'sessao_completa', 'sete_dias', 'sociavel',
  'socio_fundador', 'subida_ao_vidro', 'suplente_de_luxo', 'tie_break', 'toda_a_gente', 'todos_os_formatos',
  'trimestre_de_ferro', 'turista', 'turno_da_noite', 'um_ano_de_casa', 'velha_guarda', 'world_class',
  'zona_nobre',
  // As 27 do Marketing (#625, 12 out).
  'desforra', 'ida_e_volta', 'golias_abaixo', 'outra_vez_voces', 'a_primeira', 'equilibrista',
  'padel_ao_almoco', 'domingo_as_8', 'sexta_13_da_sorte', 'aplauso_geral', 'padel_de_natal', 'fecho_de_ano',
  'ano_novo_padel_novo', 'par_perfeito', 'noite_de_santos', 'bronzeado_de_padel', 'esgotado', 'fecha_campo',
  'a_malta_toda', 'casa_cheia', 'alma_do_grupo', 'fiel_ao_clube', 'sobrevivente', 'classico',
  'batismo_de_campo', 'boca_a_boca', 'embaixador_da_bola',
  // As três da estrada (design-handoff/2026-10-21-conquista-primeira-rotunda).
  'deste_boleia', 'primeira_rotunda', 'ate_a_porta',
  // O pódio do ranking do mês (design-handoff/2026-10-22-premios-parceiros-avisos).
  'podio_do_mes',
  // As três do objetivo de jogos por mês (design-handoff/2026-10-27-conquistas-objetivo).
  'goal_streak_3', 'goal_streak_6', 'goal_streak_12',
  // Quebra Enguiço (design-handoff/2026-10-21-conquistas-quando-e-quebra-enguico).
  'quebra_enguico',
])

/** O endereço da medalha, ou null se esta conquista ainda não tem uma. */
export const medalUrl = (key) => (MEDAL_KEYS.has(key) ? `/medalhas/${key}.webp` : null)
