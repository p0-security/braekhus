export default {
  plugins: ["@trivago/prettier-plugin-sort-imports"],
  importOrder: ["^(cli|testing)([/]|$)", "^[.][.]?([/]|$)"],
  importOrderSeparation: true,
  importOrderSortSpecifiers: true,
};
