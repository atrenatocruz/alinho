// Criar uma liga são três chamadas seguidas (criar, gravar a categoria,
// publicar). Se uma falha, tentar outra vez continua de onde parou em vez de
// criar outra liga: `progress` guarda o que já ficou feito.

/** progress: { league: {id, slug} | null, categoryDone: boolean, published: boolean } */
export const emptyCreateProgress = () => ({ league: null, categoryDone: false, published: false })

/** O próximo passo a correr: 'create' | 'category' | 'publish' | 'done'. */
export function nextCreateStep(progress) {
  if (!progress.league) return 'create'
  if (!progress.categoryDone) return 'category'
  if (!progress.published) return 'publish'
  return 'done'
}
