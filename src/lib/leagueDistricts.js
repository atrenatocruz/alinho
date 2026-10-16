// Os distritos de Portugal (18 do continente + as duas regiões autónomas).
// O distrito do clube (organizations.district) e o da liga (leagues.district)
// são texto livre na base de dados: é por aqui que se escolhe, para o texto
// ser sempre o mesmo e «Para ti» comparar bem.
export const DISTRICTS = [
  'Aveiro', 'Beja', 'Braga', 'Bragança', 'Castelo Branco', 'Coimbra', 'Évora', 'Faro', 'Guarda',
  'Leiria', 'Lisboa', 'Portalegre', 'Porto', 'Santarém', 'Setúbal', 'Viana do Castelo', 'Vila Real', 'Viseu',
  'Açores', 'Madeira',
]

/** As opções de um Select de distrito, com a primeira («sem distrito») vazia. */
export const districtOptions = (noneLabel) => [{ value: '', label: noneLabel }, ...DISTRICTS.map((d) => ({ value: d, label: d }))]

/** Refazer o calendário apaga as datas combinadas: só pergunta se a categoria já tem jornadas. */
export const needsRescheduleConfirm = (rounds, categoryId) => rounds.some((r) => r.category_id === categoryId)
