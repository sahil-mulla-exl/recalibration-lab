import type { ReactNode } from "react";

type TabItem = { id: string; label: string };

type TabBarProps = {

  value: string;

  onValueChange: (value: string) => void;

  items: readonly TabItem[];

  trailing?: ReactNode;

};



export function TabBar({ value, onValueChange, items, trailing }: TabBarProps) {

  return (

    <div className="bg-white/90 dark:bg-slate-900/80 border border-gray-200 dark:border-slate-800 rounded-xl px-3 py-2 backdrop-blur">

      <div className="flex flex-wrap items-center justify-between gap-2">

      <div className="flex gap-2 overflow-x-auto min-w-0 flex-1">

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

      {trailing ? <div className="shrink-0 ml-auto">{trailing}</div> : null}

      </div>

    </div>

  );

}

