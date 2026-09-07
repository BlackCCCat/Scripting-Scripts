## 说明
该脚本为二次修改，原版为：[Keywos](https://github.com/Keywos) 的 [FileStore](https://github.com/Keywos/rule/tree/main/Scipting/FileStore)

## v3.0.0
- 远程资源链接调整，不再使用release链接，直接使用仓库文件夹链接，请手动更换

## v2.14.8
- fix:挂载目录无法重命名
- fix:目录内容变更导致挂载失效

## v2.14.7
- 同步原版 FileStore 1.9.7 的编辑器性能更新
- 格式化与压缩改用编辑器增量写回，降低整份文档重载造成的卡顿
- 大文件格式化增加确认提示与大小保护，避免长时间卡死或崩溃
- 优化 Terser 压缩参数，缩短 JavaScript 大文件处理时间


## v2.14.6
- 首个基于原版的二次修改版
- 调整了设置页的一些设置操作逻辑
- 首页 UI 增加悬浮按钮，用于切换不同页面
