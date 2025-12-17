module.exports = {
  apps: [
    {
      name: "ebay-api",
      script: "./server.js",
      instances: process.env.NODE_ENV === "production" ? "max" : 1,
      exec_mode: process.env.NODE_ENV === "production" ? "cluster" : "fork",

      // Environment variables
      env_production: {
        NODE_ENV: "production",
        PORT: 3000,
        LOG_LEVEL: "info",
      },
      env_development: {
        NODE_ENV: "development",
        PORT: 3000,
        LOG_LEVEL: "debug",
      },

      // Logging
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,

      // Auto-restart configuration
      max_memory_restart: "500M",
      min_uptime: "10s",
      max_restarts: 10,
      autorestart: true,

      // Graceful shutdown
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,

      // Monitoring
      instance_var: "INSTANCE_ID",
    },
  ],
};
