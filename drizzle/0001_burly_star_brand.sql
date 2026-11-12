CREATE TABLE `eval_results` (
	`id` varchar(96) NOT NULL,
	`runId` varchar(96) NOT NULL,
	`testCaseId` varchar(64) NOT NULL,
	`question` text NOT NULL,
	`expectedAnswer` text NOT NULL,
	`answer` text NOT NULL,
	`retrievedContext` text NOT NULL,
	`faithfulness` int NOT NULL,
	`relevance` int NOT NULL,
	`correctness` int NOT NULL,
	`reasoning` text NOT NULL,
	`durationMs` int NOT NULL,
	`regression` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `eval_results_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `eval_runs` (
	`id` varchar(96) NOT NULL,
	`status` enum('running','completed','failed') NOT NULL,
	`targetMode` varchar(64) NOT NULL,
	`judgeMode` varchar(64) NOT NULL,
	`testSetVersion` varchar(32) NOT NULL,
	`totalCases` int NOT NULL,
	`passedCases` int NOT NULL,
	`regressionCount` int NOT NULL,
	`avgFaithfulness` int NOT NULL,
	`avgRelevance` int NOT NULL,
	`avgCorrectness` int NOT NULL,
	`avgComposite` int NOT NULL,
	`durationMs` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `eval_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `eval_test_cases` (
	`id` varchar(64) NOT NULL,
	`question` text NOT NULL,
	`expectedAnswer` text NOT NULL,
	`tags` text NOT NULL,
	`version` varchar(32) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `eval_test_cases_id` PRIMARY KEY(`id`)
);
