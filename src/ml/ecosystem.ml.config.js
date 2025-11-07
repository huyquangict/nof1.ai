/**
 * PM2 Ecosystem Configuration for ML Service
 * Deploy ML service alongside trading bot in production
 */

module.exports = {
	apps: [
		{
			name: "nof1-ml-service",
			script: "ml_service.py",
			cwd: "./src/ml",
			interpreter: "python3",
			instances: 1,
			exec_mode: "fork",
			autorestart: true,
			watch: false,
			max_memory_restart: "1G",
			env: {
				PYTHONUNBUFFERED: "1",
			},
			error_file: "../../logs/ml-service-error.log",
			out_file: "../../logs/ml-service-out.log",
			log_date_format: "YYYY-MM-DD HH:mm:ss Z",
			merge_logs: true,
		},
	],
};
