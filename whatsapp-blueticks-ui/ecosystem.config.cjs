// PM2: npm i -g pm2 && pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
module.exports = {
  apps: [{
    name: 'whatsapp-sender',
    script: 'server.js',
    instances: 1,               // keep 1: history file + rate limits are per process
    exec_mode: 'fork',
    env: { NODE_ENV: 'production' },
    max_memory_restart: '300M',
    out_file: './logs/out.log',
    error_file: './logs/error.log',
    time: true,
  }],
};
