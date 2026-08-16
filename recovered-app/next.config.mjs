/** @type {import('next').NextConfig} */
const nextConfig = {
  // Railway runs the self-contained Next server rather than depending on the
  // nested workspace's node_modules layout at runtime.
  output: "standalone",
};

export default nextConfig;
