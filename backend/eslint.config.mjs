import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // ignoreRestSiblings: `const { passwordHash, ...rest } = user` is our
      // deliberate way of EXCLUDING sensitive fields — not an unused variable
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      // Warn, not error: some OAuth/passport typings legitimately end up as any;
      // flag them without blocking the whole lint
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
