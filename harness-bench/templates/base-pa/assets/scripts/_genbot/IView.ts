import type { Node } from "cc";

/**
 * genbot 生成的 Prefab View 运行时契约：把 prefab 根节点绑定到强类型字段。
 */
export interface IView {
    bind(root: Node): void;
}
