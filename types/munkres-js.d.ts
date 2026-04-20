declare module 'munkres-js' {
  function munkres(costMatrix: number[][]): Array<[number, number]>;
  export = munkres;
}
