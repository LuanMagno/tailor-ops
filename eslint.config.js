const CORE_RULES = {
  'no-undef': 'error',
  'no-redeclare': 'error',
  'no-const-assign': 'error',
  'no-dupe-keys': 'error',
  'no-duplicate-case': 'error',
  'no-unreachable': 'error',
  'eqeqeq': ['error', 'always'],
  'no-var': 'error',
  'prefer-const': 'error',
  'curly': ['error', 'all'],
  'semi': ['error', 'always'],
  'no-empty': ['error', { allowEmptyCatch: false }],
};

module.exports = [
  {
    ignores: ['node_modules/**', 'coverage/**'],
  },
  {
    files: ['src/**/*.gs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        SpreadsheetApp: 'readonly',
        DocumentApp: 'readonly',
        DriveApp: 'readonly',
        UrlFetchApp: 'readonly',
        PropertiesService: 'readonly',
        CacheService: 'readonly',
        LockService: 'readonly',
        HtmlService: 'readonly',
        ScriptApp: 'readonly',
        Session: 'readonly',
        Logger: 'readonly',
        Utilities: 'readonly',
        ContentService: 'readonly',
        console: 'readonly',
        module: 'readonly',
        exports: 'readonly',
      },
    },
    rules: {
      ...CORE_RULES,
      'no-unused-vars': [
        'error',
        { vars: 'local', args: 'after-used', argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly',
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      ...CORE_RULES,
      'no-unused-vars': [
        'error',
        { vars: 'all', args: 'after-used', argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
      },
    },
    rules: {
      ...CORE_RULES,
      'no-unused-vars': [
        'error',
        { vars: 'all', args: 'after-used', argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
];
