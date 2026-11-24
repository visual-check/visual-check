/**
 * The part of `@bramus/specificity` the twin tests use. The package ships `index.d.ts`, but its `exports` map has no
 * `types` condition, so `nodenext` resolution can't find it.
 */
declare module '@bramus/specificity' {
  /**
   * A selector's specificity.
   */
  interface Specificity {
    /**
     * The specificity as (ids, classes, types).
     */
    toArray(): [number, number, number]
  }

  /**
   * The specificity of each selector in a selector list.
   */
  export function calculate(selector: string): Specificity[]
}
