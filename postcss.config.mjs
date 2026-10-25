import nested from 'postcss-nested'

// Как у сайтов: подпись автора из site-kit склеивает классы `&__line`, это раскрывает postcss-nested.
export default { plugins: [nested()] }
