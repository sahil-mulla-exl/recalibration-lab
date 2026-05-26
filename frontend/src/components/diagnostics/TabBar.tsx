type TabItem = { id: string; label: string };

type TabBarProps = {

  value: string;

  onValueChange: (value: string) => void;

  items: readonly TabItem[];

};



export function TabBar({ value, onValueChange, items }: TabBarProps) {

  return (

    <div className="bg-white/90 dark:bg-slate-900/80 border border-gray-200 dark:border-slate-800 rounded-xl px-3 py-2 backdrop-blur">

      <div className="flex gap-2 overflow-x-auto">

        {items.map((item) => (

          <button

            key={item.id}

            type="button"

            onClick={() => onValueChange(item.id)}

            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${

              value === item.id

                ? "bg-blue-600 text-white"

                : "bg-white dark:bg-slate-900 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800"

            }`}

          >

            {item.label}

          </button>

        ))}

      </div>

    </div>

  );

}

