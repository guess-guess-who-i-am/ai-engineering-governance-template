const searchInput = document.querySelector('#catalog-search');
const typeSelect = document.querySelector('#product-type');
const status = document.querySelector('#catalog-status');
const results = document.querySelector('#catalog-results');
const categoryNames = {
  'ai-llm': 'AI 与大模型',
  'developer-tools': '开发工具与 IDE',
  'backend-devops': '后端、数据库与 DevOps',
  'productivity-saas': '效率与 SaaS',
  'design-creative': '设计与创意工具',
  'fintech-crypto': '金融科技与加密',
  'ecommerce-retail': '电商与零售',
  'media-consumer': '媒体与消费科技',
  automotive: '汽车',
  'retro-web': '复古网页',
  unclassified: '其他'
};

let entries = [];

function createCard(entry) {
  const article = document.createElement('article');
  article.className = 'catalog-card';
  const category = document.createElement('small');
  category.textContent = categoryNames[entry.category] || entry.category;
  const title = document.createElement('h3');
  const link = document.createElement('a');
  link.href = entry.source_url;
  link.textContent = entry.title;
  title.append(link);
  const description = document.createElement('p');
  description.textContent = entry.description;
  article.append(category, title, description);
  return article;
}

function render() {
  const query = searchInput.value.trim().toLocaleLowerCase('zh-CN');
  const category = typeSelect.value;
  const matches = entries.filter((entry) => {
    const text = `${entry.id} ${entry.title} ${entry.description} ${(entry.tags || []).join(' ')}`.toLocaleLowerCase('zh-CN');
    return (!query || text.includes(query)) && (!category || entry.category === category);
  });
  results.replaceChildren(...matches.slice(0, 18).map(createCard));
  status.textContent = `找到 ${matches.length} 条参考${matches.length > 18 ? '，当前显示前 18 条' : ''}。`;
}

async function initialize() {
  try {
    const response = await fetch('catalog.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const catalog = await response.json();
    entries = catalog.entries;
    [...new Set(entries.map((entry) => entry.category))].sort().forEach((category) => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = categoryNames[category] || category;
      typeSelect.append(option);
    });
    render();
  } catch (error) {
    status.textContent = '设计目录暂时无法读取，请使用仓库内的搜索脚本。';
    console.error('Catalog initialization failed', error);
  }
}

searchInput.addEventListener('input', render);
typeSelect.addEventListener('change', render);
initialize();
