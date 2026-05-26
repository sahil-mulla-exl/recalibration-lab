type SubTabItem = { id: string; label: string };

type SubTabBarProps = {

  value: string;

  onValueChange: (value: string) => void;

  items: readonly SubTabItem[];

};



export function SubTabBar({ value, onValueChange, items }: SubTabBarProps) {

  return (

    <div className="bg-gray-50 dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-xl px-2.5 py-2">

      <div className="flex gap-2 overflow-x-auto">

        {items.map((item) => (

          <button

            key={item.id}

            type="button"

            onClick={() => onValueChange(item.id)}

            className={`px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wide whitespace-nowrap transition-colors ${

              value === item.id

                ? "bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800"

                : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"

            }`}

          >

            {item.label}

          </button>

        ))}

      </div>

    </div>

  );

}

