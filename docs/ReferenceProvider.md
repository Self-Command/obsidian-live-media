# ReferenceProvider v1

标准源码、声明式规则和可解析的实际 img 已覆盖一般语法。只有不能由这些方式关联原件的插件才需要这个接口。

```ts
interface Reference {
  source: string;          // 源笔记库内路径
  link: string;            // 原文件的库内链接，不是缩略图 URL
  evidence: 'direct' | 'dynamic' | 'candidate' | 'unresolved';
  origin: string; offset: number;
}
interface ReferenceProvider {
  id: string; version: 1;
  references(source: string, signal: AbortSignal): Promise<Reference[]>;
  dispose?(): void;
}
```

Live Media 插件实例公开 `registerReferenceProvider(provider)`，返回注销函数。宿主插件负责取得实例的方式；不要为此依赖 Live Media 的私有数据结构。

ID 需要唯一，只允许 1–64 个字母、数字、下划线或连字符。每次返回至多读取 10,000 条，来源必须与请求笔记一致，单次三秒超时。停止工作时检查 AbortSignal。插件停用或注销时释放监听器。

即使提供者声明直接引用，最终仍通过 Obsidian 的 MetadataCache 解析真实文件；远端、Blob、缩略图及无法消歧的路径不升级成可覆盖原件。动态结果默认不选中。

声明式代码块规则示例：

```json
{
  "id": "my-gallery",
  "language": "my-gallery",
  "structure": "field",
  "field": "image",
  "evidence": "candidate",
  "enabled": true
}
```

其他结构为 `list`、`wikilinks`、`markdown`。规则不执行 JavaScript 或用户正则。默认相对源笔记解析，身份变化后重新读取，不按裸文件名猜测缩略图对应原件。
