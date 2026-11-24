/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['lunar-javascript'],
  // 输出独立可运行的 standalone 产物，供 Docker 部署使用
  output: 'standalone',
};

module.exports = nextConfig;
