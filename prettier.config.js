export default {
  importOrder: ["^(cli|testing)([/]|$)", "^[.][.]?([/]|$)"],
  importOrderSeparation: true,
  importOrderSortSpecifiers: true,
  plugins: ["@trivago/prettier-plugin-sort-imports"],
};
