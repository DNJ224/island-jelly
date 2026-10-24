# 果冻海岛

浏览器里的一小块果冻海。可以搅动海面、倾斜果冻，把椰子和卵石扔进去，看它们漂浮、沉底，或者停在沙滩上。

在线地址：<https://dnj224.github.io/island-jelly/>

梦魇武器箱开箱模拟在 <https://dnj224.github.io/island-jelly/case/> 。

## 怎么玩

- 单指划过水面起浪。
- 拖果冻的侧面，或双指拖动来倾斜，海面会晃向低的一边。
- 拿起椰子或卵石扔进去。椰子会浮着，卵石会沉下去并冒出气泡。
- 拖空白处，或按住右键，可以环绕观看。滚轮或双指捏合用来缩放。
- 空格键会随机投入一颗椰子或卵石。
- 面板里可以换口味（潟湖、树莓、青柠），并调节硬度、波浪阻尼和潮汐。

手机上点底部的「控制」打开面板。横屏时标题会收小，避免挡住海岛。

## 添加到主屏幕

用 iPhone 的 Safari 打开这个页面，点分享按钮，选择「添加到主屏幕」。之后它会像一个小应用一样全屏打开，主题色是纸色 `#ece9e3`。

## 本地运行

页面是静态文件，需要用本地服务器打开，不要直接双击 `index.html`。

```bash
python3 -m http.server 4173
```

然后访问 <http://localhost:4173/> 。

有 WebGPU 时走 WebGPU。没有时自动改用 WebGL2，着色、折射和切面层次保持同一套。两个都不可用时才会出现提示页。

## 发布到 GitHub Pages

仓库的 Settings → Pages → Build and deployment → Source 选择 **GitHub Actions**。

推送到 `main` 之后，`.github/workflows/pages.yml` 会把站点发布出去。页面地址是 <https://dnj224.github.io/island-jelly/> 。
