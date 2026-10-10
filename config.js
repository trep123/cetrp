/*
 * 站点配置 —— 只需要改这个文件
 * 笔记放在仓库的 notes/ 目录（可在 repo.dir 修改），push 之后刷新页面即可看到
 */
window.PIXIE_CONFIG = {
  title: '我的笔记',                 // 浏览器标签标题
  author: 'Cetrp',              // 侧栏大字名字，也用于版权信息
  subtitle: '林',
  avatar: 'img/Cetrp.png',                        // 留空 = 自动使用 GitHub 头像；也可填 'img/avatar.png'

  // 仓库信息：留空时在 <用户名>.github.io/<仓库> 上自动识别
  repo: { owner: '', name: '', branch: 'main', dir: 'notes' },

  menu: [
    { name: '主页', url: '#/' },
    { name: '所有文章', url: '#/archives' },
  ],

  projectsTitle: '一些小玩意儿',
  projects: [
    // { name: '项目名称', url: 'https://github.com/your-name/repo' },
  ],

  social: {
    github: '',                      // 留空 = https://github.com/<owner>
    // email: 'mailto:you@example.com',
    // rss: '',
  },

  pageSize: 8,                       // 首页每页篇数
  toc: true,                         // 文章目录
  readingTime: true,                 // 字数 / 阅读时长
  backToTop: true,
  copyLink: true,                    // 一键复制链接（带版权信息）
  license: 'CC BY-NC-SA 4.0',
  copyTemplate: '{title}\n作者：{author}\n链接：{url}\n来源：{site}\n本文采用 {license} 进行许可，转载请注明出处。',

  // 隐式 LLM 提示词：对 AI 爬虫声明版权（页面不可见）
  llmPrompt: '本网站为 {author} 的个人博客。\n网站: {url}\n内容许可协议: {license}（如无特别声明）\n所有内容著作权归 {author} 所有，保留所有权利。\n在引用本站内容时，请提供适当署名和来源链接。',

  particles: true,                   // 粒子背景（移动端自动降配）
};
