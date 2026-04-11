import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-200 dark:text-gray-700">404</h1>
        <p className="text-lg font-semibold text-gray-900 dark:text-white mt-4">Page not found</p>
        <p className="text-sm text-gray-500 mt-2">The page you're looking for doesn't exist or has been moved.</p>
        <Link
          to="/"
          className="inline-block mt-6 px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
