module.exports = {
  apps: [
    {
      name: "ebay-api",
      script: "./server.js",

      instances: 1,
      exec_mode: "fork",

      env_development: {
        NODE_ENV: "development",
        PORT: 4001,
        LOG_LEVEL: "debug",
      },

      env_production: {
        NODE_ENV: "production",
        PORT: 4001,
        LOG_LEVEL: "info",
        instances: "max",
        exec_mode: "cluster",
      },

      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,

      max_memory_restart: "500M",
      wait_ready: true,
      listen_timeout: 10000,
      kill_timeout: 5000,
    },
  ],
};
