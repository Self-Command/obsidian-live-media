# Live Media

An independently implemented Obsidian plugin for photo-style Live Photo playback and guarded, offline image compression. GPL-3.0-only.

实况保持照片外观：只显示 LIVE 标识，点击照片播放，再次点击停止。首次可见预览默认最多三秒，所有自动播放始终静音。没有播放按钮、进度条、音量控件或视频卡片。

## 当前状态 / Status

0.1.6 候选开发版本。已实现检测、播放、113 项设置、离线编码器、分步压缩预览、备份和条件恢复；原始逐功能证据见[0.1.0 复检报告](docs/复检报告.md)，最新放大播放修复见[0.1.6 记录](docs/0.1.6-放大对齐与同时播放.md)，首次加载修复见[0.1.5 记录](docs/0.1.5-播放修复复检.md)，保存流程见[0.1.4 记录](docs/0.1.4-保存状态与原图替换.md)，150 张实拍证据仍见[0.1.2 记录](docs/0.1.2-修复复检.md)。实际 Obsidian、Android、iOS 和手机相册验收仍需用户确认。正式发行被设备验收门槛阻止。

This is a candidate, not a device-certified release. CI Chromium results do not establish Obsidian, Android/iOS or phone-gallery compatibility. Unsupported or unverified structures are protected and skipped with a reason.

[已发布候选（0.1.2）](https://github.com/Self-Command/obsidian-live-media/releases/tag/candidate-1378dadca50e) · [对应 CI 验收](https://github.com/Self-Command/obsidian-live-media/actions/runs/37508868803)

## 使用流程

1. 将指定 Actions 候选的 `main.js`、`manifest.json`、`styles.css` 放入**独立测试库**的 `.obsidian/plugins/live-media/`。三文件包含所需离线引擎，不需要 CDN。
2. 启用后打开含实况图片的文章；普通图片仍使用宿主行为。Simple Gallery 标准列表无需改写语法。
3. 运行“检查并压缩当前文章图片”或“检查并压缩全库图片”：选择范围 → 临时编码 → 照片式对比 → 最终确认 → 保存并读回。
4. 默认保存同扩展名副本，原件及文章引用保持原样。主动选择替换时先备份，遇到后续用户修改拒绝恢复覆盖。

Selected files can be added through the searchable file picker. Dynamic render references and unknown syntax candidates require explicit selection. Shared originals list affected notes.

## 保护范围

- JPEG Motion Photo / MicroVideo：视频单独压缩、SDR 图片单独压缩和双重压缩；须通过时间、音轨、方向、索引及封面校验。
- Ultra HDR：固定 libultrahdr 源码重建及完整解码。不能保留附加元数据、调整 HDR 尺寸或处理不支持的布局时跳过。
- Apple JPEG + MOV：可信身份和 keyed timed metadata 检测；独立视频轨道重组保留原照片、音轨和必要轨道。实验压缩默认关闭，真实手机识别待验证；HEIC 重编码及 Apple 图片重编码受保护。
- 普通 JPEG、8-bit PNG、静态 WebP：仅处理已验证路线；动画、特殊 ICC、未知 HDR、未验证 HEIF/AVIF 等不降格转换。
- WebCodecs 尚未通过保护测试，不参与自动选择；`auto` 使用已通过离线门槛的 WASM。本机 FFmpeg 需每台设备单独授权。

## 文档

- [使用和设置手册](docs/设置手册.md)、[113 项设置参考](docs/设置参考.md)、[通用插件来源接口](docs/ReferenceProvider.md)
- [格式与插件兼容矩阵](docs/兼容矩阵.md)、[备份与恢复](docs/恢复说明.md)
- [开发契约 v2](docs/插件开发文档.md)、[实施追踪](docs/实施计划.md)、[逐功能复检](docs/复检报告.md)
- [编码器对应源码与构建说明](codecs/BUILDING.md)

## 构建与产物 / Builds

All compilation and automated tests run in GitHub Actions. The first lock file was generated in Actions; subsequent jobs use `npm ci`. A build artifact is downloaded into a separate verification job, then reused unchanged as a candidate. Each package records commit SHA, run ID, attempt and file SHA256. Formal release downloads that same verified package; it does not rebuild.

Private photographs are never included in public source or CI. Codec sources are pinned, their licenses accompany the candidate, and an exact corresponding-source artifact is supplied with the same run.

0.1.2 针对实拍批次编码失败、Worker 资源释放和 Motion Photo 时间精度的修复及 150 张本机实拍验证，见[修复复检记录](docs/0.1.2-修复复检.md)。私人照片未上传；实际 Obsidian 与移动端仍待用户验收。
